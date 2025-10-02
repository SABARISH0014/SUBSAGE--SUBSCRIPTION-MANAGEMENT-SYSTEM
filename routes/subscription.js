const express = require('express');
const router = express.Router();
const db = require('../database/connection'); // Assumes db exports async functions
const { ensureAuthenticated } = require('../utils/authUtils'); 


// --- GET Handler for the "Add Subscription" Page ---
// Path: /subscriptions/add
router.get('/add', ensureAuthenticated, (req, res) => {
    // These variables allow you to pre-select options in the form
    const name = req.query.name || '';
    const type = req.query.type || '';

    // CRITICAL FIX: Ensure the view name is lowercase 'addsubscription'
    // to prevent case-sensitivity issues on deployment servers.
    return res.render('addsubscription', { 
        user: req.session.user, 
        name: name, 
        type: type 
    });
});


// Route to fetch all subscriptions for the logged-in user 
// Path: /subscriptions/manage-subscriptions
router.get('/manage-subscriptions', ensureAuthenticated, async (req, res) => {
    const query = 'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY expiry DESC';
    
    try {
        const subscriptions = await db.all(query, [req.session.user.id]);
        
        // Ensure the view name is lowercase
        return res.render('manage-subscriptions', { subscriptions: subscriptions });
    } catch (err) {
        console.error('Error fetching subscriptions:', err);
        return res.status(500).send('Error fetching subscriptions');
    }
});


// Route to render the update form (Path: /subscriptions/update/:id)
router.get('/update/:id', ensureAuthenticated, async (req, res) => {
    const query = 'SELECT * FROM subscriptions WHERE id = $1';

    try {
        const subscription = await db.get(query, [req.params.id]);
        
        if (!subscription) {
            console.error('Subscription not found:', req.params.id);
            return res.status(404).send('Subscription not found');
        }

        // Ensure the view name is lowercase
        return res.render('update-subscription', {
            subscription: subscription,
            category: subscription.type 
        });
    } catch (err) {
        console.error('Error fetching subscription:', err);
        return res.status(500).send('Error fetching subscription');
    }
});

// POST route to update subscription in the database (Path: /subscriptions/update/:id)
router.post('/update/:id', ensureAuthenticated, async (req, res) => {
    const { name, type, start, expiry, amount } = req.body;
    
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

    const query = `UPDATE subscriptions SET name = $1, type = $2, start = $3, expiry = $4, amount = $5 WHERE id = $6`;

    try {
        await db.run(query, [name, type, start, expiry, numericAmount, req.params.id]);

        return res.redirect('/subscriptions/manage-subscriptions'); 
    } catch (err) {
        console.error('Error updating subscription:', err);
        return res.status(500).send('Error updating subscription');
    }
});

// Route to delete a subscription (Path: /subscriptions/delete/:id)
router.get('/delete/:id', ensureAuthenticated, async (req, res) => {
    const query = 'DELETE FROM subscriptions WHERE id = $1';

    try {
        await db.run(query, [req.params.id]);

        return res.redirect('/subscriptions/manage-subscriptions'); 
    } catch (err) {
        console.error('Error deleting subscription:', err);
        return res.status(500).send('Error deleting subscription');
    }
});

// POST request to add a subscription (Path: /subscriptions/add)
router.post('/add', ensureAuthenticated, async (req, res) => {
    const user_id = req.session.user.id;
    const { name, type, start, expiry, amount } = req.body;

    // --- Validation Checks with early exit ---
    if (!user_id || !name || !type || !start || !expiry || !amount) {
        console.log('Missing required fields');
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

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
    // ----------------------------------------

    const query = `
        INSERT INTO subscriptions (user_id, name, type, start, expiry, amount) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id
    `;

    try {
        // 1. Run the query and capture the result
        const result = await db.run(query, [user_id, name, type, start, expiry, numericAmount]);
        
        const subscriptionId = result && result.rows && result.rows[0] ? result.rows[0].id : null;
        
        // 2. Explicitly return JSON, guaranteeing no fall-through
        return res.status(200).json({
            success: true,
            message: 'Subscription added successfully',
            id: subscriptionId
        });
    } catch (err) {
        console.error('Error adding subscription:', err);
        // Ensure error response sends 500 status with JSON
        return res.status(500).json({ success: false, message: 'Database error: Could not add subscription.' });
    }
});

module.exports = router;
