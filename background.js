/**
 * Developer: Meher Salim
 * File: background.js
 * Description:
 * This script runs continuously in the background, even when no Chrome windows are open.
 * It handles:
 * - Periodic ticket checks using Chrome alarms
 * - Storage management for ticket activity data
 * - Message routing between popup, content scripts, and background
 * - Automatic ticket closure logic
 */

// Configuration object - easy to modify settings in one place
const CONFIG = {
  CLOSE_AFTER_DAYS: 7,                    // Number of days before auto-closing
  CHECK_INTERVAL_MINUTES: 60,             // How often to check tickets (in minutes)
  LAST_ACTIVE_KEY: 'ticket_last_active',  // Storage key for activity timestamps
  CLOSED_TICKETS_KEY: 'closed_tickets'    // Storage key for closed ticket history
};

/**
 * Initialize extension when installed or updated
 * 
 * Chrome fires this event:
 * - When user first installs the extension
 * - When extension is updated to a new version
 * - When Chrome is launched after extension was disabled
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('Ticket Auto-Closer installed - Starting background service');
  
  /**
   * Create a repeating alarm for periodic ticket checks
   * 
   * Chrome alarms are more reliable than setTimeout/setInterval because they:
   * - Continue running even if the service worker is terminated
   * - Wake up the service worker when alarm fires
   * - Persist across browser restarts
   */
  chrome.alarms.create('checkTickets', {
    periodInMinutes: CONFIG.CHECK_INTERVAL_MINUTES  // Repeat every X minutes
  });
  
  /**
   * Initialize storage with empty arrays if they don't exist
   * 
   * Storage is persistent and survives browser restarts.
   * Each extension has its own isolated storage space (up to 10MB).
   */
  chrome.storage.local.get([CONFIG.CLOSED_TICKETS_KEY], (result) => {
    // Check if storage key already exists
    if (!result[CONFIG.CLOSED_TICKETS_KEY]) {
      // Create empty array to track closed tickets
      chrome.storage.local.set({ [CONFIG.CLOSED_TICKETS_KEY]: [] });
      console.log('Initialized storage for closed tickets');
    }
  });
});

/**
 * Handle alarm events (scheduled tasks)
 * 
 * Chrome triggers this whenever any alarm created by this extension fires.
 * We only have one alarm currently: 'checkTickets'
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTickets') {
    console.log('Alarm triggered - Checking all tracked tickets');
    checkAllTickets();  // Perform the actual ticket checking logic
  }
});

/**
 * Listen for messages from content scripts and popup
 * 
 * Message passing is how different parts of the extension communicate.
 * Chrome extensions are isolated for security, so they must use messages.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`Received message: ${request.action} from ${sender.tab ? 'content script' : 'popup'}`);
  
  // Handle different message types based on the 'action' property
  if (request.action === 'updateTicketActivity') {
    // Content script notifying that user interacted with a ticket
    updateTicketActivity(request.ticketId);
    sendResponse({ success: true });
    
  } else if (request.action === 'closeTicket') {
    // Request to manually close a specific ticket
    closeTicket(request.ticketId, sender.tab.id);
    sendResponse({ success: true });
    
  } else if (request.action === 'getTicketStatus') {
    // Popup requesting status information about a ticket
    // This is async, so we return true to keep message channel open
    getTicketStatus(request.ticketId).then(status => sendResponse(status));
    return true;  // Important for async responses!
    
  } else if (request.action === 'forceCheck') {
    // Manual trigger from popup (for testing/debugging)
    checkAllTickets();
    sendResponse({ success: true });
  }
  
  // Return false (default) for sync responses, true for async
  return false;
});

/**
 * Check all tracked tickets for inactivity and close if needed
 * 
 * This runs periodically via the alarm system and scans through
 * all tickets that have activity timestamps stored.
 */
async function checkAllTickets() {
  // Retrieve all stored ticket activity data
  chrome.storage.local.get([CONFIG.LAST_ACTIVE_KEY], (result) => {
    const tickets = result[CONFIG.LAST_ACTIVE_KEY] || {};
    const now = Date.now();  // Current timestamp in milliseconds
    
    // Calculate cutoff time: current time minus 7 days (in milliseconds)
    // 7 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
    const cutoffTime = now - (CONFIG.CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    
    console.log(`Checking ${Object.keys(tickets).length} tracked tickets`);
    
    // Iterate through each tracked ticket
    for (const [ticketId, lastActive] of Object.entries(tickets)) {
      // Check if ticket hasn't been active since cutoff time
      if (lastActive < cutoffTime) {
        console.log(`Ticket ${ticketId} is ready to close (inactive since ${new Date(lastActive)})`);
        // Notify any open tabs to close this ticket
        notifyTicketToClose(ticketId);
      }
    }
  });
}

/**
 * Update or create activity timestamp for a ticket
 * 
 * This gets called whenever a user interacts with a ticket page.
 * Timestamps are used to calculate inactivity periods.
 * 
 * @param {string} ticketId - Unique identifier for the ticket
 */
function updateTicketActivity(ticketId) {
  // Use chrome.storage.local for persistent, extension-specific storage
  chrome.storage.local.get([CONFIG.LAST_ACTIVE_KEY], (result) => {
    // Get existing tickets or initialize empty object
    const tickets = result[CONFIG.LAST_ACTIVE_KEY] || {};
    
    // Update timestamp for this ticket (milliseconds since Unix epoch)
    tickets[ticketId] = Date.now();
    
    // Save back to storage
    chrome.storage.local.set({ [CONFIG.LAST_ACTIVE_KEY]: tickets });
    console.log(`Updated activity for ticket ${ticketId}`);
  });
}

/**
 * Get status information for a specific ticket
 * 
 * Used by popup to display current ticket state.
 * Returns status, time remaining until closure, and last active timestamp.
 * 
 * @param {string} ticketId - Unique identifier for the ticket
 * @returns {Promise<Object>} Status object with ticket information
 */
async function getTicketStatus(ticketId) {
  return new Promise((resolve) => {
    // Retrieve both storage keys we need
    chrome.storage.local.get(
      [CONFIG.LAST_ACTIVE_KEY, CONFIG.CLOSED_TICKETS_KEY], 
      (result) => {
        const tickets = result[CONFIG.LAST_ACTIVE_KEY] || {};
        const closedTickets = result[CONFIG.CLOSED_TICKETS_KEY] || [];
        
        const lastActive = tickets[ticketId];
        const isClosed = closedTickets.includes(ticketId);
        
        // Build response object with default values
        let status = {
          status: 'unknown',        // Current state: active/closed/ready_to_close
          timeRemaining: null,      // Milliseconds until auto-close
          lastActive: null          // Last activity timestamp
        };
        
        // Determine status based on stored data
        if (isClosed) {
          status.status = 'closed';
        } else if (lastActive) {
          const now = Date.now();
          const age = now - lastActive;  // How long since last activity
          const maxAge = CONFIG.CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000;
          
          if (age >= maxAge) {
            status.status = 'ready_to_close';  // Ready for closure
          } else {
            status.status = 'active';          // Still within time limit
            status.timeRemaining = maxAge - age;  // Time left before closing
          }
          status.lastActive = lastActive;
        } else {
          status.status = 'not_tracked';  // Never seen this ticket before
        }
        
        resolve(status);
      }
    );
  });
}

/**
 * Notify all open tabs to check and potentially close a ticket
 * 
 * Broadcasts a message to every tab that might have the ticket open.
 * The content script will handle closing if it's on that ticket's page.
 * 
 * @param {string} ticketId - Ticket that should be closed
 */
function notifyTicketToClose(ticketId) {
  // Query all tabs (no filters means all tabs)
  chrome.tabs.query({}, (tabs) => {
    console.log(`Notifying ${tabs.length} tabs about ticket ${ticketId}`);
    
    // Send message to each tab
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'checkAndCloseTicket',  // Tell content script to check
        ticketId: ticketId               // Which ticket to check
      }).catch(() => {
        // Catch and ignore errors - tab might not have content script
        // This is expected for tabs not on ticket pages
        console.log(`Tab ${tab.id} doesn't have content script (not a ticket page)`);
      });
    }
  });
}

/**
 * Close a specific ticket
 * 
 * Triggered when user confirms they want to close a ticket.
 * Sends message to specific tab that has the ticket open.
 * 
 * @param {string} ticketId - Ticket to close
 * @param {number} tabId - ID of tab where ticket is open
 */
function closeTicket(ticketId, tabId) {
  console.log(`Attempting to close ticket ${ticketId} in tab ${tabId}`);
  
  // Send message to specific tab only (more efficient)
  chrome.tabs.sendMessage(tabId, {
    action: 'executeCloseTicket',  // Command to close the ticket
    ticketId: ticketId
  }, (response) => {
    // Check if close was successful
    if (response && response.success) {
      console.log(`Successfully closed ticket ${ticketId}`);
      
      // Record that this ticket has been closed
      chrome.storage.local.get([CONFIG.CLOSED_TICKETS_KEY], (result) => {
        const closedTickets = result[CONFIG.CLOSED_TICKETS_KEY] || [];
        
        // Add to closed tickets list if not already there
        if (!closedTickets.includes(ticketId)) {
          closedTickets.push(ticketId);
          chrome.storage.local.set({ [CONFIG.CLOSED_TICKETS_KEY]: closedTickets });
          console.log(`Recorded ticket ${ticketId} in closed tickets list`);
        }
      });
    } else {
      console.warn(`Failed to close ticket ${ticketId} - no response or error`);
    }
  });
}
