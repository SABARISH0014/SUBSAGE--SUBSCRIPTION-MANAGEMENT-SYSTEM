const express = require('express');
const bcrypt = require('bcrypt'); // Import bcrypt
const router = express.Router();
const db = require('../database/connection');

// Handle user signup
router.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  console.log("Received signup credentials:", username, password); // Log the incoming credentials

  // Simple validation for missing fields
  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }

  const query = `SELECT * FROM users WHERE username = ?`;

  db.get(query, [username], async (err, existingUser) => {
    if (err) {
      console.error('Error checking username:', err.message);
      return res.status(500).send('Error checking username availability');
    }

    if (existingUser) {
      return res.status(400).send('Username already exists'); // Username already taken
    }

    try {
      // Hash the password using bcrypt
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Insert new user with hashed password
      const insertQuery = `INSERT INTO users (username, password) VALUES (?, ?)`;

      db.run(insertQuery, [username, hashedPassword], function (err) {
        if (err) {
          console.error('Error creating user:', err.message);
          return res.status(500).send('Error creating user');
        }

        console.log('User created with ID:', this.lastID); // Log the user ID
        return res.redirect('/login'); // Redirect to login after successful signup
      });
    } catch (hashError) {
      console.error('Error hashing password:', hashError.message);
      return res.status(500).send('Error creating user');
    }
  });
});

// Handle user login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  console.log("Received login credentials:", username, password); // Log the incoming credentials

  const query = `SELECT * FROM users WHERE username = ?`;

  db.get(query, [username], async (err, user) => {
    if (err) {
      console.error('Error logging in:', err.message);
      return res.status(500).send('Error logging in');
    }

    // Log the user data from the database
    console.log("User from database:", user);

    if (user) {
      try {
        // Compare the provided password with the stored hashed password
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
          req.session.user = { id: user.id, username: user.username }; // Store user in session
          return res.redirect('/dashboard'); // Redirect to dashboard
        } else {
          return res.status(401).send('Invalid username or password'); // Credentials mismatch
        }
      } catch (compareError) {
        console.error('Error comparing passwords:', compareError.message);
        return res.status(500).send('Error logging in');
      }
    } else {
      return res.status(401).send('Invalid username or password'); // No user found
    }
  });
});

module.exports = router;
