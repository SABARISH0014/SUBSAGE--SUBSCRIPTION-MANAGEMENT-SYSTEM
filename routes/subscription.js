const express = require('express');
const router = express.Router();
const db = require('../database/connection'); // Assuming you have a database connection file

// Route to fetch all subscriptions for the logged-in user
router.get('/manage-subscriptions', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login'); // Redirect to login if not authenticated
  }

  // SQL query to fetch subscriptions for the logged-in user
  const query = 'SELECT * FROM Subscriptions WHERE user_id = ?';
  
  db.all(query, [req.session.user.id], (err, rows) => {
    if (err) {
      console.error('Error fetching subscriptions:', err.message);
      return res.status(500).send('Error fetching subscriptions');
    }

    // Render the manage-subscriptions.ejs view with subscription data
    res.render('manage-subscriptions', { subscriptions: rows });
  });
});

router.get('/subscriptions/update/:id', (req, res) => {
  const query = 'SELECT * FROM Subscriptions WHERE id = ?';

  db.get(query, [req.params.id], (err, row) => {
      if (err) {
          console.error('Error fetching subscription:', err.message);
          return res.status(500).send('Error fetching subscription');
      }

      if (!row) {
          console.error('Subscription not found:', req.params.id);
          return res.status(404).send('Subscription not found');
      }

      res.render('update-subscription', {
        subscription: row,
        category: req.query.subscription.type
    });
  });
});
// POST route to update subscription in the database
router.post('/subscriptions/update/:id', (req, res) => {
  const { name, type, start, expiry, amount } = req.body;
  
  // Ensure the data is valid
  const startDate = new Date(start);
  const expiryDate = new Date(expiry);
  if (isNaN(startDate.getTime()) || isNaN(expiryDate.getTime())) {
    console.log('Invalid date format');
    return res.status(400).json({ success: false, message: 'Invalid date format' });
  }

  if (isNaN(amount) || parseFloat(amount) <= 0) {
    console.log('Invalid amount');
    return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
  }

  // SQL query to update the subscription
  const query = `UPDATE Subscriptions SET name = ?, type = ?, start = ?, expiry = ?, amount = ? WHERE id = ?`;

  db.run(query, [name, type, start, expiry, amount, req.params.id], function (err) {
    if (err) {
      console.error('Error updating subscription:', err.message);
      return res.status(500).send('Error updating subscription');
    }

    res.redirect('/manage-subscriptions'); // Redirect back to the subscription management page
  });
});

// Route to delete a subscription
router.get('/subscriptions/delete/:id', (req, res) => {
  const query = 'DELETE FROM Subscriptions WHERE id = ?';

  db.run(query, [req.params.id], function (err) {
    if (err) {
      console.error('Error deleting subscription:', err.message);
      return res.status(500).send('Error deleting subscription');
    }

    res.redirect('/manage-subscriptions'); // Redirect back to the subscription management page
  });
});

// POST request to add a subscription
router.post('/add', (req, res) => {
  const { user_id, name, type, start, expiry, amount } = req.body;

  // Validate that all required fields are provided
  if (!user_id || !name || !type || !start || !expiry || !amount) {
    console.log('Missing required fields');
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Ensure the start and expiry dates are valid
  const startDate = new Date(start);
  const expiryDate = new Date(expiry);
  if (isNaN(startDate.getTime()) || isNaN(expiryDate.getTime())) {
    console.log('Invalid date format');
    return res.status(400).json({ success: false, message: 'Invalid date format' });
  }

  // Ensure amount is a positive number
  if (isNaN(amount) || parseFloat(amount) <= 0) {
    console.log('Invalid amount');
    return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
  }

  // SQL query to insert data into the Subscriptions table
  const query = `INSERT INTO Subscriptions (user_id, name, type, start, expiry, amount) VALUES (?, ?, ?, ?, ?, ?)`;

  // Insert the data into the database
  db.run(query, [user_id, name, type, start, expiry, amount], function (err) {
    if (err) {
      console.error('Error adding subscription:', err.message);
      return res.status(500).json({ success: false, message: 'Error adding subscription' });
    }

    // Respond with success and the ID of the newly added subscription
    res.json({
      success: true,
      message: 'Subscription added successfully',
      id: this.lastID
    });
  });
});

module.exports = router;
