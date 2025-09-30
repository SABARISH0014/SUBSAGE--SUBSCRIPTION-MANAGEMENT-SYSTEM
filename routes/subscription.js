const express = require('express');
const router = express.Router();
const db = require('../database/connection'); // Assumes db exports async functions

// Route to fetch all subscriptions for the logged-in user (FIXED - ASYNC)
router.get('/manage-subscriptions', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    // Use PostgreSQL placeholder $1
    const query = 'SELECT * FROM "Subscriptions" WHERE user_id = $1 ORDER BY expiry DESC';
    
    try {
        // ASYNC Call: Use await db.all
        const subscriptions = await db.all(query, [req.session.user.id]);
        
        // Render the manage-subscriptions.ejs view with subscription data
        res.render('manage-subscriptions', { subscriptions: subscriptions });
    } catch (err) {
        console.error('Error fetching subscriptions:', err);
        return res.status(500).send('Error fetching subscriptions');
    }
});

// Route to render the update form (FIXED - ASYNC)
router.get('/subscriptions/update/:id', async (req, res) => {
    // Use PostgreSQL placeholder $1
    const query = 'SELECT * FROM "Subscriptions" WHERE id = $1';

    try {
        // ASYNC Call: Use await db.get
        const subscription = await db.get(query, [req.params.id]);
        
        if (!subscription) {
            console.error('Subscription not found:', req.params.id);
            return res.status(404).send('Subscription not found');
        }

        res.render('update-subscription', {
            subscription: subscription,
            // Access type directly from the fetched object
            category: subscription.type 
        });
    } catch (err) {
        console.error('Error fetching subscription:', err);
        return res.status(500).send('Error fetching subscription');
    }
});

// POST route to update subscription in the database (FIXED - ASYNC)
router.post('/subscriptions/update/:id', async (req, res) => {
    const { name, type, start, expiry, amount } = req.body;
    
    // Ensure the data is valid
    const startDate = new Date(start);
    const expiryDate = new Date(expiry);
    const numericAmount = parseFloat(amount);

    if (isNaN(startDate.getTime()) || isNaN(expiryDate.getTime())) {
        console.log('Invalid date format');
        return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    if (isNaN(numericAmount) || numericAmount <= 0) {
        console.log('Invalid amount');
        return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    // SQL query to update the subscription. Uses $1 to $6.
    const query = `UPDATE "Subscriptions" SET name = $1, type = $2, start = $3, expiry = $4, amount = $5 WHERE id = $6`;

    try {
        // ASYNC Call: Use await db.run
        await db.run(query, [name, type, start, expiry, numericAmount, req.params.id]);

        res.redirect('/manage-subscriptions');
    } catch (err) {
        console.error('Error updating subscription:', err);
        return res.status(500).send('Error updating subscription');
    }
});

// Route to delete a subscription (FIXED - ASYNC)
router.get('/subscriptions/delete/:id', async (req, res) => {
    // Use PostgreSQL placeholder $1
    const query = 'DELETE FROM "Subscriptions" WHERE id = $1';

    try {
        // ASYNC Call: Use await db.run
        await db.run(query, [req.params.id]);

        res.redirect('/manage-subscriptions');
    } catch (err) {
        console.error('Error deleting subscription:', err);
        return res.status(500).send('Error deleting subscription');
    }
});

// POST request to add a subscription (FIXED - ASYNC)
router.post('/add', async (req, res) => {
    const { user_id, name, type, start, expiry, amount } = req.body;

    // Validate that all required fields are provided
    if (!user_id || !name || !type || !start || !expiry || !amount) {
        console.log('Missing required fields');
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Ensure the start and expiry dates are valid
    const startDate = new Date(start);
    const expiryDate = new Date(expiry);
    const numericAmount = parseFloat(amount);
    
    if (isNaN(startDate.getTime()) || isNaN(expiryDate.getTime())) {
        console.log('Invalid date format');
        return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    // Ensure amount is a positive number
    if (isNaN(numericAmount) || numericAmount <= 0) {
        console.log('Invalid amount');
        return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    // SQL query to insert data. Uses $1 to $6.
    const query = `INSERT INTO "Subscriptions" (user_id, name, type, start, expiry, amount) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;

    try {
        // ASYNC Call: Use await db.run
        const result = await db.run(query, [user_id, name, type, start, expiry, numericAmount]);
        
        // Respond with success and the ID of the newly added subscription
        res.json({
            success: true,
            message: 'Subscription added successfully',
            // Postgres insert result might not have 'this.lastID'. 
            // We return the ID from the result of the RETURNING clause in the query.
            id: result && result.rows && result.rows[0] ? result.rows[0].id : null
        });
    } catch (err) {
        console.error('Error adding subscription:', err);
        return res.status(500).json({ success: false, message: 'Error adding subscription' });
    }
});

module.exports = router;
