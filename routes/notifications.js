const express = require('express');
const db = require('../database/connection');
// Removed the redundant nodemailer import here.
const router = express.Router();

// CRITICAL FIX: Import the centralized email helper function from the main app module
const { sendNotificationEmail } = require('../app');


router.get('/', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userId = req.session.user.id;

    const currentDate = new Date().toISOString();
    const nextWeekDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Updated to use lowercase 'subscriptions'
    const query = `
        SELECT * FROM subscriptions
        WHERE user_id = $1 AND expiry BETWEEN $2 AND $3
    `;

    try {
        const subscriptions = await db.all(query, [userId, currentDate, nextWeekDate]);
        
        const notifications = subscriptions.map(subscription => {
            return {
                user_id: userId,
                subscription_id: subscription.id,
                subscription_name: subscription.name,
                subscription_type: subscription.type,
                expiry: subscription.expiry,
                message: `Your subscription to ${subscription.name} will expire soon!`,
                notified_at: new Date().toISOString(),
            };
        });

        // Updated to use lowercase 'notifications'
        const insertQuery = `
            INSERT INTO notifications (user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        for (const notification of notifications) {
            await db.run(insertQuery, [
                notification.user_id, 
                notification.subscription_id, 
                notification.subscription_name, 
                notification.subscription_type, 
                notification.expiry, 
                notification.message, 
                notification.notified_at,
            ]);
            
            // Now correctly calls the exported function from app.js
            await sendNotificationEmail(notification.user_id, notification);
        }

        res.render('notifications', { notifications });
        
    } catch (error) {
        console.error('Error in GET /notifications:', error);
        return res.status(500).send('Error processing notifications.');
    }
});

router.post('/store', async (req, res) => {
    const { user_id, subscription_id, subscription_name, subscription_type, message, notified_at } = req.body;

    if (!user_id || !subscription_id || !subscription_name || !subscription_type || !message || !notified_at) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    try {
        // Updated to use lowercase 'subscriptions'
        const getExpiryQuery = `SELECT expiry FROM subscriptions WHERE id = $1`;
        const row = await db.get(getExpiryQuery, [subscription_id]);

        if (!row) {
            return res.status(404).json({ success: false, message: 'Subscription not found' });
        }

        const expiry = row.expiry;

        // Updated to use lowercase 'notifications'
        const insertQuery = `
            INSERT INTO notifications (user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        await db.run(insertQuery, [user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at]);
        
        // Now correctly calls the exported function from app.js
        await sendNotificationEmail(user_id, {
            subscription_name: subscription_name,
            expiry: expiry,
        });

        res.status(200).json({ success: true, message: 'Notification saved and email sent successfully' });

    } catch (error) {
        console.error('Error in POST /store:', error);
        return res.status(500).json({ success: false, message: 'Error processing request.' });
    }
});

module.exports = router;
