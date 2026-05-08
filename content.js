/**
 * CONTENT SCRIPT
 * 
 * This script runs within the context of a web page (ticket page).
 * It has access to the DOM but runs in an isolated environment.
 * 
 * Responsibilities:
 * - Detect current ticket ID from URL
 * - Track user interactions (clicks, typing, scrolling)
 * - Show notifications when ticket is ready to close
 * - Communicate with background script via messages
 */

// Global variables to maintain state across function calls
let currentTicketId = null;      // ID of the current ticket being viewed
let statusCheckInterval = null;  // Timer reference for status polling

/**
 * Extract ticket ID from the current page URL
 * 
 * Different support systems have different URL patterns.
 * This function tries multiple patterns to find the ticket ID.
 * 
 * @returns {string|null} Ticket ID if found, null otherwise
 */
function getTicketIdFromUrl() {
  const url = window.location.href;
  console.log(`Parsing URL for ticket ID: ${url}`);
  
  // Pattern 1: Zendesk format - /tickets/12345
  // Example: https://yourdomain.zendesk.com/agent/tickets/12345
  let match = url.match(/\/tickets\/(\d+)/);
  if (match) {
    console.log(`Found Zendesk-style ticket ID: ${match[1]}`);
    return match[1];
  }
  
  // Pattern 2: Freshdesk format - /tickets/12345
  // Example: https://yourdomain.freshdesk.com/a/tickets/12345
  match = url.match(/\/tickets\/(\d+)/);
  if (match) {
    console.log(`Found Freshdesk-style ticket ID: ${match[1]}`);
    return match[1];
  }
  
  // Pattern 3: Query parameter format - ?ticket_id=12345
  // Example: https://support.example.com/view?ticket_id=12345
  match = url.match(/[?&]ticket_id=(\d+)/);
  if (match) {
    console.log(`Found query parameter ticket ID: ${match[1]}`);
    return match[1];
  }
  
  // Pattern 4: Generic numeric ID at end of URL
  // Example: https://support.example.com/ticket/12345
  match = url.match(/\/ticket[s]?\/(\d+)/i);
  if (match) {
    console.log(`Found generic ticket ID: ${match[1]}`);
    return match[1];
  }
  
  console.warn('Could not extract ticket ID from URL');
  return null;
}

/**
 * Initialize the content script
 * 
 * Called when the page first loads or when DOM is ready.
 * Sets up all tracking and monitoring for the current ticket.
 */
function initialize() {
  console.log('Initializing Ticket Auto-Closer content script');
  
  // Extract ticket ID from URL
  currentTicketId = getTicketIdFromUrl();
  
  if (currentTicketId) {
    console.log(`Now tracking ticket: ${currentTicketId}`);
    
    // Step 1: Update activity timestamp (shows ticket is being viewed)
    updateActivity();
    
    // Step 2: Set up event listeners for user interactions
    setupActivityTracking();
    
    // Step 3: Start periodic status checks (shows notification if ready)
    startStatusCheck();
    
    // Step 4: Check if ticket is already scheduled for closing
    checkInitialStatus();
  } else {
    console.log('Not on a ticket page - auto-closer inactive');
  }
}

/**
 * Update activity timestamp for current ticket
 * 
 * Sends a message to the background script to record that
 * the user is currently viewing/interacting with this ticket.
 */
function updateActivity() {
  if (!currentTicketId) return;
  
  console.log(`Updating activity for ticket ${currentTicketId}`);
  
  chrome.runtime.sendMessage({
    action: 'updateTicketActivity',
    ticketId: currentTicketId
  }).catch(error => {
    // Extension context might be invalid (e.g., after reload)
    console.warn('Failed to send activity update:', error);
  });
}

/**
 * Set up event listeners to track user activity
 * 
 * Monitors various user interactions that indicate the ticket is
 * still being worked on. When activity is detected, we update
 * the timestamp to reset the inactivity counter.
 */
function setupActivityTracking() {
  console.log('Setting up activity tracking events');
  
  // Types of events that count as "activity"
  const events = [
    'click',      // Mouse clicks on any element
    'keypress',   // Keyboard input (typing comments/updates)
    'scroll',     // Scrolling through the ticket
    'mousemove'   // Mouse movement (indicates user is present)
  ];
  
  let activityTimeout;  // Debounce timeout to avoid too many updates
  
  /**
   * Debounced activity handler
   * 
   * Instead of updating on every single event (which could be thousands),
   * we wait for user to stop interacting for 1 second before updating.
   * This reduces storage writes and improves performance.
   */
  function handleActivity() {
    // Clear any pending timeout
    if (activityTimeout) clearTimeout(activityTimeout);
    
    // Set new timeout to update after 1 second of inactivity
    activityTimeout = setTimeout(() => {
      console.log('User activity detected - updating timestamp');
      updateActivity();
    }, 1000);
  }
  
  // Attach event listeners to the entire document
  events.forEach(event => {
    document.addEventListener(event, handleActivity, { 
      passive: true,  // Performance optimization for scroll events
      capture: false   // Use bubbling phase (more efficient)
    });
  });
  
  console.log(`Tracking ${events.length} activity event types`);
}

/**
 * Start periodic status checking
 * 
 * Polls the background script every 30 seconds to get the
 * current status of the ticket. When status becomes 'ready_to_close',
 * we show a notification.
 */
function startStatusCheck() {
  // Clear any existing interval to prevent duplicates
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }
  
  console.log('Starting periodic status checks (every 30 seconds)');
  
  // Set up interval to check status
  statusCheckInterval = setInterval(async () => {
    if (!currentTicketId) return;
    
    const status = await getTicketStatus();
    console.log(`Ticket status: ${status.status}`, status);
    
    // React based on ticket status
    if (status.status === 'ready_to_close') {
      console.log('Ticket is ready to close - showing notification');
      showCloseNotification(status.timeRemaining);
    } else if (status.status === 'closed') {
      console.log('Ticket is already closed - showing badge');
      showClosedBadge();
    }
    // For 'active' status, we don't show anything
  }, 30000);  // Check every 30 seconds (in milliseconds)
}

/**
 * Check initial ticket status on page load
 * 
 * Performs a single status check when page first loads
 * to see if ticket was already ready to close.
 */
async function checkInitialStatus() {
  console.log('Checking initial ticket status');
  const status = await getTicketStatus();
  
  if (status.status === 'ready_to_close') {
    console.log('Ticket already ready to close on page load');
    showCloseNotification(status.timeRemaining);
  } else if (status.status === 'closed') {
    console.log('Ticket already closed');
    showClosedBadge();
  }
}

/**
 * Get ticket status from background script
 * 
 * Wrapper function that returns a promise for the status.
 * 
 * @returns {Promise<Object>} Status object from background
 */
function getTicketStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'getTicketStatus',
      ticketId: currentTicketId
    }, resolve);
  });
}

/**
 * Show visual notification that ticket is ready to close
 * 
 * Creates a floating notification UI element with:
 * - Warning message about 7 days of inactivity
 * - Close button to immediately close the ticket
 * - Auto-dismiss after 30 seconds
 * 
 * @param {number} timeRemaining - Milliseconds remaining (unused but informative)
 */
function showCloseNotification(timeRemaining) {
  // Remove any existing notification to avoid duplicates
  removeNotification();
  
  console.log('Creating close notification UI');
  
  // Create main container div
  const notification = document.createElement('div');
  notification.id = 'ticket-auto-closer-notification';
  
  // Use innerHTML for complex structure with inline styles
  // This ensures styles work even if page CSS conflicts exist
  notification.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px 20px;
      border-radius: 10px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 350px;
      animation: slideIn 0.3s ease-out;
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 24px;">⏰</span>
        <div style="flex: 1;">
          <strong style="font-size: 16px;">Ticket Ready to Close</strong><br>
          <span style="font-size: 14px; opacity: 0.95;">
            This ticket has been inactive for 7 days
          </span>
        </div>
        <button id="close-ticket-btn" style="
          background: #ff6b6b;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          transition: transform 0.2s;
        " 
        onmouseover="this.style.transform='scale(1.05)'" 
        onmouseout="this.style.transform='scale(1)'">
          Close
        </button>
      </div>
    </div>
    <style>
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    </style>
  `;
  
  // Add notification to the page
  document.body.appendChild(notification);
  
  // Get reference to the close button
  const closeBtn = document.getElementById('close-ticket-btn');
  if (closeBtn) {
    // Add click handler to manually close the ticket
    closeBtn.addEventListener('click', () => {
      console.log('User clicked close button');
      manualCloseTicket();
      removeNotification();
    });
  } else {
    console.warn('Could not find close button element');
  }
  
  // Auto-remove notification after 30 seconds
  // This prevents notifications from piling up
  setTimeout(() => {
    console.log('Auto-removing notification after timeout');
    removeNotification();
  }, 30000);
}

/**
 * Manually close the current ticket via user action
 * 
 * Sends request to background script to close the ticket,
 * then performs the actual DOM manipulation to click the close button.
 */
function manualCloseTicket() {
  console.log(`Manual close requested for ticket ${currentTicketId}`);
  
  // First, send message to background to record closure
  chrome.runtime.sendMessage({
    action: 'closeTicket',
    ticketId: currentTicketId
  }, (response) => {
    if (response && response.success) {
      console.log('Background confirmed ticket closure');
      showSuccessMessage('Ticket closed successfully!');
      
      // Now perform the actual UI action to close ticket
      actuallyCloseTicket();
    } else {
      console.error('Failed to close ticket - no response from background');
      showErrorMessage('Failed to close ticket. Please try again.');
    }
  });
}

/**
 * Actually perform the ticket closing action on the page
 * 
 * This function clicks the appropriate button in the support system's UI.
 * Different systems have different selectors - we try multiple options.
 */
function actuallyCloseTicket() {
  console.log('Attempting to click close button on page');
  
  // Array of possible selectors for close buttons
  // Order matters - more specific selectors should come first
  const closeButtons = [
    'button[data-test-id="ticket-close-button"]',  // Some systems use data attributes
    'button:contains("Close ticket")',              // Text-based selector (jQuery style)
    'button:contains("Mark as Closed")',            // Alternative text
    'button:contains("Resolve")',                   // Some systems use "Resolve"
    '.ticket-close-btn',                            // Class name based
    '[data-action="close-ticket"]',                 // Custom data attribute
    'button.close-ticket',                          // Another class variation
    '[aria-label="Close ticket"]'                   // Accessibility label
  ];
  
  // Try each selector until we find a matching button
  for (const selector of closeButtons) {
    let button = null;
    
    // Handle pseudo-selectors like :contains differently
    if (selector.includes(':contains')) {
      // Simple contains implementation for demo
      // In production, you'd need a proper implementation
      const buttons = document.querySelectorAll('button');
      const textToFind = selector.match(/contains\("(.+)"\)/)[1];
      button = Array.from(buttons).find(btn => btn.textContent.includes(textToFind));
    } else {
      // Standard CSS selector
      button = document.querySelector(selector);
    }
    
    if (button) {
      console.log(`Found close button with selector: ${selector}`);
      button.click();
      
      // Optional: Wait for confirmation dialog if present
      setTimeout(() => {
        handleCloseConfirmation();
      }, 500);
      
      return;  // Exit after first successful click
    }
  }
  
  console.warn('Could not find any close button on the page');
  
  // Fallback: Show manual instruction if button not found
  showManualCloseInstruction();
}

/**
 * Handle confirmation dialogs that might appear after clicking close
 * 
 * Some support systems show a confirmation dialog (e.g., "Are you sure?").
 * This function looks for and clicks confirmation buttons.
 */
function handleCloseConfirmation() {
  console.log('Checking for confirmation dialog');
  
  const confirmSelectors = [
    'button:contains("Confirm")',
    'button:contains("Yes")',
    'button:contains("OK")',
    '[data-test-id="confirm-close"]',
    '.confirm-dialog .confirm-btn'
  ];
  
  for (const selector of confirmSelectors) {
    let button = null;
    
    if (selector.includes(':contains')) {
      const buttons = document.querySelectorAll('button');
      const textToFind = selector.match(/contains\("(.+)"\)/)[1];
      button = Array.from(buttons).find(btn => btn.textContent.includes(textToFind));
    } else {
      button = document.querySelector(selector);
    }
    
    if (button) {
      console.log(`Found confirmation button: ${selector}`);
      button.click();
      return;
    }
  }
  
  console.log('No confirmation dialog detected (or already handled)');
}

/**
 * Show manual close instruction when automated button finding fails
 * 
 * Creates a notification with step-by-step instructions for manual closing.
 */
function showManualCloseInstruction() {
  const instructionDiv = document.createElement('div');
  instructionDiv.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #ff9800;
    color: white;
    padding: 15px;
    border-radius: 8px;
    z-index: 10000;
    font-family: sans-serif;
    max-width: 300px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  `;
  
  instructionDiv.innerHTML = `
    <strong>⚠️ Ticket Auto-Closer</strong><br>
    Could not automatically close this ticket.<br><br>
    Please manually close it using the support system's interface.<br><br>
    <small style="opacity:0.8">The ticket has been marked as ready for closure.</small>
    <button onclick="this.parentElement.remove()" style="
      margin-top: 10px;
      background: white;
      color: #ff9800;
      border: none;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
    ">Dismiss</button>
  `;
  
  document.body.appendChild(instructionDiv);
  
  // Auto-remove after 10 seconds
  setTimeout(() => instructionDiv.remove(), 10000);
}

/**
 * Show success message after ticket is closed
 * 
 * @param {string} message - Success message to display
 */
function showSuccessMessage(message) {
  const successDiv = document.createElement('div');
  successDiv.textContent = message;
  successDiv.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #4caf50;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 10000;
    font-family: sans-serif;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(successDiv);
  
  // Auto-remove after 3 seconds
  setTimeout(() => successDiv.remove(), 3000);
}

/**
 * Show error message when closure fails
 * 
 * @param {string} message - Error message to display
 */
function showErrorMessage(message) {
  const errorDiv = document.createElement('div');
  errorDiv.textContent = message;
  errorDiv.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #f44336;
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 10000;
    font-family: sans-serif;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 5000);
}

/**
 * Show badge indicating ticket was auto-closed
 * 
 * Displays a small indicator in the corner showing the ticket
 * was automatically closed due to inactivity.
 */
function showClosedBadge() {
  // Remove existing badge to prevent duplicates
  const existingBadge = document.getElementById('ticket-closed-badge');
  if (existingBadge) existingBadge.remove();
  
  const badge = document.createElement('div');
  badge.id = 'ticket-closed-badge';
  badge.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #666;
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-family: monospace;
      z-index: 10000;
      opacity: 0.8;
    ">
      ✓ Auto-Closed (7 days inactive)
    </div>
  `;
  
  document.body.appendChild(badge);
  
  // Auto-remove after 10 seconds
  setTimeout(() => badge.remove(), 10000);
}

/**
 * Remove any existing notification from DOM
 * 
 * Prevents multiple notifications from appearing simultaneously.
 */
function removeNotification() {
  const notification = document.getElementById('ticket-auto-closer-notification');
  if (notification) {
    console.log('Removing existing notification');
    notification.remove();
  }
}

/**
 * Listen for messages from background script
 * 
 * Handles commands from the service worker, particularly
 * notifications that a ticket should be closed.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`Content script received message: ${request.action}`);
  
  if (request.action === 'checkAndCloseTicket' && request.ticketId === currentTicketId) {
    // Background is telling us to check if this ticket needs closing
    console.log(`Background requested check for ticket ${request.ticketId}`);
    getTicketStatus().then(status => {
      if (status.status === 'ready_to_close') {
        console.log('Ticket confirmed ready - showing notification');
        showCloseNotification(status.timeRemaining);
      }
    });
    sendResponse({ received: true });
    
  } else if (request.action === 'executeCloseTicket' && request.ticketId === currentTicketId) {
    // Background is directly commanding us to close this ticket
    console.log(`Background commanded closure of ticket ${request.ticketId}`);
    manualCloseTicket();
    sendResponse({ success: true });
    
  } else {
    // Message not for this ticket or unknown action
    sendResponse({ received: false, reason: 'not_my_ticket' });
  }
  
  return true;  // Keep message channel open for async response
});

/**
 * Initialize when DOM is ready
 * 
 * Different browsers might fire DOMContentLoaded at different times.
 * This ensures we initialize regardless of when the script loads.
 */
if (document.readyState === 'loading') {
  // Document still loading - wait for event
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  // Document already loaded - initialize immediately
  initialize();
}