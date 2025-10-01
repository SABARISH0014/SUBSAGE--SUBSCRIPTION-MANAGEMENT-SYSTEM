const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../database/connection');
const axios = require('axios'); // Required for reCAPTCHA
// Assuming dotenv is loaded in app.js, so process.env is available

// --- Handle user signup (POST /auth/signup) ---
router.post('/signup', async (req, res) => {
    const { email, username, password, 'g-recaptcha-response': reCAPTCHAResponse } = req.body;

    if (!reCAPTCHAResponse) {
        // Use res.render as in app.js for consistency
        return res.render('signup', { message: 'reCAPTCHA is required.' });
    }

    try {
        // 1. reCAPTCHA Verification
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const verificationResponse = await axios.post(verificationUrl, null, {
            params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: reCAPTCHAResponse }
        });
        if (!verificationResponse.data.success) {
            return res.render('signup', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        // 2. Input Validation
        if (!username || !password || !email) {
            return res.render('signup', { message: 'All fields are required.' });
        }

        // 3. Check for existing user
        const checkQuery = `SELECT id FROM users WHERE email = $1`;
        const existingUser = await db.get(checkQuery, [email]);

        if (existingUser) {
            return res.render('signup', { message: 'User already exists.' });
        }

        // 4. Hash and Insert
        const hashedPassword = await bcrypt.hash(password, 10);
        const insertQuery = 'INSERT INTO users (email, username, password) VALUES ($1, $2, $3)';
        await db.run(insertQuery, [email, username, hashedPassword]);

        // 5. Success
        // Redirect back to login with a success message (using session flash for a robust solution)
        req.flash('success', 'User registered successfully. You can now log in!');
        return res.redirect('/login');

    } catch (error) {
        console.error('Error during signup process:', error);
        return res.render('signup', { message: 'An internal error occurred during sign up.' });
    }
});

// --- Handle user login (POST /auth/login) ---
router.post('/login', async (req, res) => {
    const { username, password, 'g-recaptcha-response': reCAPTCHAResponse } = req.body;

    if (!reCAPTCHAResponse) {
        return res.render('login', { message: 'reCAPTCHA is required.' });
    }

    try {
        // 1. reCAPTCHA Verification
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const verificationResponse = await axios.post(verificationUrl, null, {
            params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: reCAPTCHAResponse }
        });
        if (!verificationResponse.data.success) {
            return res.render('login', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        // 2. Fetch User
        const user = await db.get('SELECT * FROM users WHERE username = $1', [username]);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.render('login', { message: 'Invalid username or password.' });
        }

        // 3. Session Setup
        req.session.user = { id: user.id, username: user.username };

        // 4. Redirect to intended page (if saved by middleware) or dashboard
        const redirectTo = req.session.redirectTo || '/dashboard';
        delete req.session.redirectTo;
        
        return res.redirect(redirectTo);

    } catch (error) {
        console.error('Error during login process:', error);
        return res.render('login', { message: 'An internal error occurred during login.' });
    }
});


module.exports = router;