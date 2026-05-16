/**
 * Developer: Meher Salim
 * File: popup.js
 * Description:
 * This script runs when the extension icon is clicked and the popup opens.
 * It displays real-time information about the current ticket and provides
 * manual controls for checking and closing tickets.
 */

/**
 * Initialize when popup HTML is fully loaded
 * 
 * Chrome fires DOMContentLoaded event when popup is ready.
 * We set up UI event listeners and fetch initial data.
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup opened - initializing UI');
  
  // Get the currently active tab (the one user is viewing)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    console.log(`Current tab URL: ${currentTab.url}`);
    updateUIForTab(currentTab);
  });
  
  // Set up manual check button
  const manualCheckBtn = document.getElementById('manualCheckBtn');
  if (manualCheckBtn) {
    manualCheckBtn.addEventListener('click', () => {
      console.log('Manual check triggered by user');
      manualCheckTickets();
    });
  }
  
  // Set up settings button (placeholder for future functionality)
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      console.log('Settings button clicked');
      openSettings();
    });
  }
});

/**
 * Update popup UI based on the current tab's content
 * 
 * Determines if current tab is a ticket page and displays
 * relevant information about that ticket.
 * 
 * @param {Object} tab - Chrome tab object with url and id properties
 */
async function updateUIForTab(tab) {
  console.log(`Updating UI for tab: ${tab.id}`);
  
  // Extract ticket ID from tab URL
  const ticketId = extractTicketIdFromUrl(tab.url);
  
  if (ticketId) {
    console.log(`Found ticket ID in current tab: ${ticketId}`);
    document.getElementById('currentTicket').textContent = ticketId;
    
    // Fetch ticket status from background script
    const status = await getTicketStatus(ticketId);
    console.log(`Ticket status received:`, status);
    
    // Update UI with status information
    updateStatusDisplay(status);
  } else {
    console.log('Current tab is not a ticket page');
    document.getElementById('currentTicket').textContent = 'No ticket detected';
    document.getElementById('ticketStatus').textContent = 'Not on a ticket page';
    document.getElementById('ticketStatus').className = '';
    document.getElementById('inactiveTime').textContent = 'N/A';
    document.getElementById('timeRemaining').textContent = 'N/A';
  }
}

/**
 * Extract ticket ID from a URL string
 * 
 * Uses multiple regex patterns to detect ticket IDs in various formats.
 * 
 * @param {string} url - URL to parse
 * @returns {string|null} Ticket ID if found, null otherwise
 */
function extractTicketIdFromUrl(url) {
  if (!url) {
    console.warn('No URL provided to extractTicketIdFromUrl');
    return null;
  }
  
  // Array of patterns to try (order matters - most specific first)
  const patterns = [
    /\/tickets\/(\d+)/,           // Standard format
    /\/ticket\/(\d+)/,             // Singular format
    /[?&]ticket_id=(\d+)/,        // Query parameter
    /[?&]id=(\d+)/,               // Generic ID parameter
    /\/(\d{5,})\//                // Any 5+ digit number in URL (likely ticket ID)
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      console.log(`Extracted ticket ID ${match[1]} using pattern: ${pattern}`);
      return match[1];
    }
  }
  
  console.log('No ticket ID pattern matched in URL');
  return null;
}

/**
 * Get ticket status from background script
 * 
 * Sends message to service worker and returns promise with status.
 * 
 * @param {string} ticketId - ID of ticket to check
 * @returns {Promise<Object>} Status object from background
 */
function getTicketStatus(ticketId) {
  console.log(`Requesting status for ticket ${ticketId}`);
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'getTicketStatus',
      ticketId: ticketId
    }, (response) => {
      console.log(`Received status response:`, response);
      resolve(response);
    });
  });
}

/**
 * Update the popup display with ticket status information
 * 
 * Shows different colors, messages, and progress based on ticket state.
 * 
 * @param {Object} status - Status object from background script
 */
function updateStatusDisplay(status) {
  console.log('Updating UI with status:', status);
  
  const statusElement = document.getElementById('ticketStatus');
  const inactiveElement = document.getElementById('inactiveTime');
  const timeRemainingElement = document.getElementById('timeRemaining');
  const progressFill = document.getElementById('progressFill');
  
  // Handle different status types
  if (status.status === 'closed') {
    // Ticket has been closed already
    statusElement.textContent = '✓ Closed';
    statusElement.className = 'status-closed';
    inactiveElement.textContent = 'Ticket closed';
    timeRemainingElement.textContent = 'N/A';
    progressFill.style.width = '100%';
    progressFill.style.background = '#ccc';
    
  } else if (status.status === 'ready_to_close') {
    // Ticket is eligible for closing
    statusElement.textContent = '⚠️ Ready to close';
    statusElement.className = 'status-warning';
    inactiveElement.textContent = '7+ days';
    timeRemainingElement.textContent = 'Close now';
    progressFill.style.width = '100%';
    progressFill.style.background = '#ff9800';
    
  } else if (status.status === 'active' && status.timeRemaining !== null) {
    // Ticket is active and being tracked
    statusElement.textContent = '🟢 Active';
    statusElement.className = 'status-active';
    
    // Calculate and display inactivity period
    const inactiveDays = calculateDaysAgo(status.lastActive);
    inactiveElement.textContent = formatDays(inactiveDays);
    
    // Calculate and display time remaining
    const remainingDays = Math.ceil(status.timeRemaining / (24 * 60 * 60 * 1000));
    timeRemainingElement.textContent = formatDays(remainingDays);
    
    // Update progress bar (7 days = 100%)
    const progress = ((7 - remainingDays) / 7) * 100;
    const boundedProgress = Math.min(100, Math.max(0, progress));
    progressFill.style.width = `${boundedProgress}%`;
    progressFill.style.background = 'linear-gradient(90deg, #667eea, #764ba2)';
    
  } else if (status.status === 'not_tracked') {
    // Ticket exists but not in our tracking system yet
    statusElement.textContent = 'Not tracking';
    statusElement.className = '';
    inactiveElement.textContent = 'No activity recorded';
    timeRemainingElement.textContent = 'Interact to start';
    progressFill.style.width = '0%';
    
  } else {
    // Unknown or error state
    statusElement.textContent = 'Unknown';
    statusElement.className = '';
    inactiveElement.textContent = 'Error';
    timeRemainingElement.textContent = 'Error';
    progressFill.style.width = '0%';
  }
}

/**
 * Calculate days since given timestamp
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {number} Number of full days since timestamp
 */
function calculateDaysAgo(timestamp) {
  if (!timestamp) return 0;
  const diff = Date.now() - timestamp;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

/**
 * Format days for display (adds pluralization)
 * 
 * @param {number} days - Number of days
 * @returns {string} Formatted string (e.g., "3 days" or "1 day")
 */
function formatDays(days) {
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * Trigger manual check of all tickets
 * 
 * Sends message to background to force an immediate check.
 * Shows temporary feedback to user.
 */
function manualCheckTickets() {
  console.log('Sending forceCheck message to background');
  
  chrome.runtime.sendMessage({ action: 'forceCheck' }, (response) => {
    if (response && response.success) {
      console.log('Manual check completed successfully');
      showTemporaryMessage('Manual check triggered!');
    } else {
      console.error('Manual check failed');
      showTemporaryMessage('Check failed - see console');
    }
  });
}

/**
 * Open settings page (placeholder for future feature)
 * 
 * Currently shows alert, but could open options page in future.
 */
function openSettings() {
  console.log('Opening settings (feature not yet implemented)');
  
  // Future implementation could use:
  // chrome.runtime.openOptionsPage();
  
  alert('Settings page coming soon!\n\nFor now, you can modify CONFIG in background.js');
}

/**
 * Show temporary message on the button
 * 
 * Changes button text temporarily to provide feedback.
 * 
 * @param {string} message - Message to display
 */
function showTemporaryMessage(message) {
  const button = document.getElementById('manualCheckBtn');
  if (!button) return;
  
  const originalText = button.textContent;
  button.textContent = message;
  
  // Restore original text after 2 seconds
  setTimeout(() => {
    button.textContent = originalText;
  }, 2000);
}
