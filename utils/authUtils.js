const ensureAuthenticated = (req, res, next) => {
    // Check if user session data exists
    if (req.session.user) {
        return next();
    }
    
    // If not authenticated, save the current URL and redirect to login
    req.session.redirectTo = req.originalUrl;
    res.redirect('/login');
};

module.exports = { ensureAuthenticated };
