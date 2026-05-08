# Ticket Auto-Closer

A Chrome extension that automatically monitors and closes inactive support tickets after 7 days of no user activity.

## Features

- 🔍 **Automatic Ticket Detection** - Identifies ticket IDs from URLs across multiple support platforms
- ⏱️ **Activity Tracking** - Monitors user interactions (clicks, typing, scrolling) to reset inactivity timers
- 🔔 **Smart Notifications** - Displays non-intrusive notifications when tickets become eligible for closure
- 🎯 **One-Click Closing** - Automatically clicks the close button when user confirms
- 📊 **Real-time Status** - Popup interface shows current ticket status, time remaining, and visual progress bar
- 💾 **Persistent Storage** - Tracks ticket activity across browser restarts using Chrome's storage API
- 🔄 **Periodic Checks** - Background service checks all tracked tickets every hour

## Supported Platforms

The extension works with any support system that uses URL patterns containing ticket IDs. It comes pre-configured for:

- Zendesk (`*.zendesk.com/agent/tickets/*`)
- Freshdesk (`*.freshdesk.com/a/tickets/*`)

## Installation

### From Chrome Web Store (Coming Soon)

1. Visit the Chrome Web Store listing
2. Click "Add to Chrome"

### Manual Installation (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/ticket-auto-closer.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked"

5. Select the extension directory

## Configuration

### Adjust Auto-Close Time

Edit `background.js` and modify the `CONFIG` object:

```javascript
const CONFIG = {
  CLOSE_AFTER_DAYS: 7,                    // Change to desired days
  CHECK_INTERVAL_MINUTES: 60,             // How often to check tickets
  LAST_ACTIVE_KEY: 'ticket_last_active',
  CLOSED_TICKETS_KEY: 'closed_tickets'
};
```

### Add Your Support System

Update the `host_permissions` in `manifest.json` and URL patterns in `content.js`:

**manifest.json:**
```json
"host_permissions": [
  "https://your-support-system.com/*"
]
```

**content.js - Update URL patterns:**
```javascript
// In getTicketIdFromUrl() function, add your pattern:
match = url.match(/\/your-ticket-path\/(\d+)/);
```

**manifest.json - Content script matches:**
```json
"content_scripts": [{
  "matches": ["https://your-support-system.com/tickets/*"]
}]
```

## How It Works

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Popup UI      │────▶│   Background    │◀────│  Content Script │
│  (popup.html)   │     │  Service Worker │     │   (content.js)  │
└─────────────────┘     │  (background.js) │     └─────────────────┘
                        └─────────────────┘              │
                              │                          │
                              ▼                          ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Chrome Storage │     │   Web Page DOM  │
                        │   (ticket data) │     │  (ticket UI)    │
                        └─────────────────┘     └─────────────────┘
```

### Component Responsibilities

| Component | File | Responsibilities |
|-----------|------|------------------|
| **Background Worker** | `background.js` | - Maintains alarms for periodic checks<br>- Manages Chrome storage for ticket data<br>- Routes messages between components<br>- Executes auto-close logic |
| **Content Script** | `content.js` | - Extracts ticket ID from URL<br>- Tracks user interactions<br>- Injects notifications into page<br>- Clicks close buttons |
| **Popup Interface** | `popup.html` + `popup.js` | - Displays current ticket status<br>- Shows progress bar<br>- Provides manual controls |
| **Styles** | `styles.css` | - Notification animations<br>- Tooltip styling<br>- Responsive and accessibility features |

### Data Flow

1. **User visits a ticket page** → Content script detects ticket ID → Sends activity update to background
2. **Background stores timestamp** → Updates `ticket_last_active` in Chrome storage
3. **User is inactive for 7 days** → Alarm triggers → Background checks all tracked tickets
4. **Ticket found inactive** → Background broadcasts message to all tabs
5. **Tab with that ticket receives message** → Content script shows notification
6. **User clicks "Close"** → Content script sends close request → Background records closure → Content script clicks UI button

## Manual Controls

### Popup Interface

Click the extension icon to open the popup:

- **Current Ticket** - Displays the ticket ID of the active tab
- **Status** - Shows if ticket is Active, Ready to Close, or Closed
- **Inactive For** - Days since last user interaction
- **Time to Close** - Days remaining until auto-close
- **Progress Bar** - Visual indicator of how close ticket is to closing
- **Force Check Tickets** - Manually trigger a check of all tickets
- **Settings** - Placeholder for future configuration UI

## Development

### Project Structure

```
ticket-auto-closer/
├── manifest.json          # Extension configuration
├── background.js          # Service worker (background)
├── content.js             # Page injection script
├── popup.html            # Popup interface HTML
├── popup.js              # Popup interface logic
├── styles.css            # Additional styles for injected elements
└── icons/                # Extension icons (16, 48, 128px)
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Building Icons

Create icons in the `icons/` directory with these sizes:
- `icon16.png` - 16×16 pixels (toolbar)
- `icon48.png` - 48×48 pixels (extensions page)
- `icon128.png` - 128×128 pixels (Chrome Web Store)

### Testing

1. Load the extension in developer mode
2. Navigate to a ticket page in your support system
3. Check the console (F12) for logs:
   - Background script: `chrome://extensions/` → Click "service worker" link
   - Content script: DevTools console on the web page
   - Popup: Right-click extension icon → "Inspect popup"

### Debugging Tips

**Enable verbose logging:**
All console logs are active by default. Remove or comment out `console.log` statements in production code.

**Simulate inactivity:**
Modify the cutoff time in `background.js` temporarily:
```javascript
const cutoffTime = now - (1 * 24 * 60 * 60 * 1000); // 1 day instead of 7
```

**Clear storage for testing:**
```javascript
// Run in extension's service worker console
chrome.storage.local.clear();
```

## Customizing Notifications

Edit the notification styles in `content.js`'s `showCloseNotification()` function:

```javascript
notification.innerHTML = `
  <div style="
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    /* Modify colors, sizes, positioning here */
  ">
`;
```

## Browser Compatibility

| Browser | Minimum Version | Status |
|---------|----------------|--------|
| Chrome | 88+ | ✅ Fully supported |
| Edge | 88+ | ✅ Fully supported (Chromium-based) |
| Brave | 1.20+ | ✅ Fully supported |
| Opera | 74+ | ✅ Fully supported |
| Firefox | ❌ | Not supported (Manifest V2 only) |
| Safari | ❌ | Not supported |

## Privacy

- **No external servers** - All data stays in your local browser storage
- **No analytics** - Extension doesn't collect any usage statistics
- **Minimal permissions** - Only requests necessary permissions:
  - `storage` - Save ticket activity data locally
  - `alarms` - Schedule periodic checks
  - `activeTab` - Access current page to detect ticket ID
  - Host permissions - Only for support system domains you specify

## Troubleshooting

### Extension not detecting tickets

**Issue:** "No ticket detected" appears in popup

**Solutions:**
1. Ensure the URL pattern matches those in `manifest.json`
2. Add your URL pattern to `getTicketIdFromUrl()` in `content.js`
3. Check the content script console for URL parsing logs

### Notifications not appearing

**Issue:** Ticket ready to close but no notification

**Solutions:**
1. Verify background service worker is running (`chrome://extensions/`)
2. Check if ticket is actually tracked (`chrome.storage.local` in console)
3. Ensure content script is injected (page should show console logs)

### Auto-close not working

**Issue:** Extension doesn't click the close button automatically

**Solutions:**
1. The support system's close button selector may differ. Update `closeButtons` array in `content.js`:
   ```javascript
   const closeButtons = [
     'your-custom-selector-here',
     // Add more selectors as needed
   ];
   ```
2. Use browser DevTools to inspect the close button and find its unique selector

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Priorities

- [ ] Add options page for configuration without editing code
- [ ] Support for more helpdesk platforms (Jira, ServiceNow, HubSpot)
- [ ] Batch closing of multiple ready tickets
- [ ] Export/import of closed ticket history
- [ ] Keyboard shortcuts for quick actions

## License

MIT License - See [LICENSE](LICENSE) file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/ticket-auto-closer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/ticket-auto-closer/discussions)

## Acknowledgments

- Built with Chrome Extension Manifest V3
- Uses Chrome Alarms API for reliable background scheduling
- Designed with accessibility and performance in mind

---

**Made for support teams who want to keep their ticket queues clean** 🎫
