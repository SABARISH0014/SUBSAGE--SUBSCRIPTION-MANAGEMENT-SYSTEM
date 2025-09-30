const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../database/connection');

router.post('/signup', async (req, res) => {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
        return res.status(400).send('Email, username, and password are required.');
    }

    const checkQuery = `SELECT * FROM "Users" WHERE username = $1 OR email = $2`;

    try {
        const existingUser = await db.get(checkQuery, [username, email]);

        if (existingUser) {
            return res.status(400).send('Username or email already exists');
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const insertQuery = `INSERT INTO "Users" (email, username, password) VALUES ($1, $2, $3)`;

        await db.run(insertQuery, [email, username, hashedPassword]);

        return res.redirect('/login');

    } catch (error) {
        console.error('Error during signup process:', error);
        return res.status(500).send('An error occurred during user creation.');
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const query = `SELECT * FROM "Users" WHERE username = $1`;

    try {
        const user = await db.get(query, [username]);

        if (!user) {
            return res.status(401).send('Invalid username or password');
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
            req.session.user = { id: user.id, username: user.username };
            return res.redirect('/dashboard');
        } else {
            return res.status(401).send('Invalid username or password');
        }
    } catch (error) {
        console.error('Error during login process:', error);
        return res.status(500).send('An error occurred during login.');
    }
});

module.exports = router;
