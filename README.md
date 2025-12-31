# 🏡 Family Day Planner

A beautiful, shared family planning app with dynamic schedule generation, task management, and Google Calendar integration.

## Features

✨ **Evening Planning Wizard** - Plan tomorrow in 5 easy steps
☀️ **Dynamic Today View** - Schedule regenerates as real wake/nap times change
✅ **Task Manager** - Brain dump + daily focus lists
📖 **Day Logs** - View past schedules and tracking data
📅 **Google Calendar Export** - Sync scheduled blocks to your calendar
🔒 **Shared Password Access** - No individual accounts needed
📱 **Progressive Web App** - Works offline, install on any device

## Quick Start

1. **Read SETUP.md** for complete deployment instructions
2. Set up Supabase database
3. Configure Google Calendar API
4. Deploy serverless OAuth backend (Cloudflare/Netlify/Vercel)
5. Update `app.js` with your credentials
6. Deploy to GitHub Pages

## Password

Default password: `JuneR0cks!`

Change it in `app.js`:
```javascript
const CONFIG = {
    PASSWORD: 'YourNewPassword!',
    // ...
};
```

## Family Members

- Kristyn
- Julio
- Nanny
- Kayden (excluded from baby nap assignments)

## Technology Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Database**: Supabase (PostgreSQL with RLS)
- **OAuth**: Cloudflare Workers / Netlify / Vercel Functions
- **Hosting**: GitHub Pages (static site)
- **PWA**: Service Worker for offline support

## Project Structure

```
family-planner/
├── index.html              # Main app
├── styles.css              # Warm, family-oriented design
├── app.js                  # Application logic
├── manifest.json           # PWA manifest
├── service-worker.js       # Offline caching
├── supabase.sql           # Database schema
├── serverless/            # OAuth backend options
│   ├── cloudflare-worker.js
│   └── netlify-functions.js
├── SETUP.md               # Detailed setup guide
└── create-icons.html      # Icon generation helper
```

## Design Philosophy

The app features a warm, earth-toned design inspired by family life:
- Serif headers (Instrument Serif) for warmth and personality
- Clean sans-serif body text (Karla) for readability
- Soft beige/sage backgrounds
- Generous spacing and rounded corners
- Smooth animations and transitions
- Mobile-first responsive design

## How It Works

### Evening Planning
1. Open the wizard before bed
2. Set tomorrow's wake target
3. Add appointments
4. Select nap caregivers (Kayden can't do baby naps)
5. Review constraints
6. Quick brain dump tasks

### Today Tracking
1. Enter actual wake time (schedule regenerates)
2. Toggle naps on/off
3. Use Start/Stop buttons to track nap times
4. Schedule automatically adjusts in real-time
5. Export to Google Calendar

### Task Management
- **Brain Dump**: Capture tasks without a specific date
- **Today's Focus**: Tasks assigned to today
- **Completed**: Check off when done

### History
View past day logs with actual wake times and schedule details.

## Data Model

All data stored in Supabase with space_id = 'default':

- **settings**: App configuration and constraints
- **day_plans**: Evening wizard outputs for future dates
- **day_logs**: Actual tracking data (wake times, naps)
- **tasks**: Task list with status and assignment

## Security Notes

⚠️ **Important**: 
- Password is client-side only (anyone with link can try passwords)
- Supabase anon key is exposed in frontend (normal for public apps)
- RLS policies restrict access to space_id='default' only
- For stronger security, add Supabase Auth or server-side validation

## Browser Support

- Chrome/Edge 90+
- Safari 14+
- Firefox 88+
- Mobile browsers (iOS Safari 14+, Chrome Android)

## License

Private family use. Not licensed for distribution.

## Support

See SETUP.md for detailed troubleshooting.

---

Built with ❤️ for busy families
