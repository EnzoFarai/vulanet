// vite.config.js
export default {
  server: {
    // Custom middleware to handle clean URLs without needing the 'vite' module import
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url.split('?')[0];

        if (url.startsWith('/profile/')) {
          req.url = '/pages/profile.html' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
        } else if (url === '/settings' || url === '/settings/') {
          req.url = '/pages/settings.html';
        } else if (url.startsWith('/settings/')) {
          const page = url.replace('/settings/', '');
          req.url = `/pages/settings/${page}.html`;
        } else if (url === '/help' || url === '/help/') {
          req.url = '/pages/help.html';
        } else if (url === '/help/support-request') {
          req.url = '/pages/help/support-request.html';
        } else if (url === '/policy' || url === '/policies') {
          req.url = '/pages/policies.html';
        } else if (url === '/acknowledgements') {
          req.url = '/pages/acknowledgements.html';
        }

        next();
      });
    }
  }
};
