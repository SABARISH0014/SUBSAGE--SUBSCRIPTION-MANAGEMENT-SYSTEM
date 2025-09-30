const express = require('express');
const db = require('../database/connection');
const nodemailer = require('nodemailer');
const router = express.Router();


async function sendNotificationEmail(userId, subscription) {
    try {
        const userRow = await db.get('SELECT email FROM "Users" WHERE id = $1', [userId]);

        if (!userRow) {
            return;
        }

        const userEmail = userRow.email; 
        const subject = `Subscription Expiring Soon: ${subscription.subscription_name}`;
        const message = `Hello,\n\nYour subscription to ${subscription.subscription_name} is expiring soon on ${subscription.expiry}.\nPlease renew it to continue enjoying the benefits.\n\nBest regards,\nSubSage`;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL,
                pass: process.env.EMAIL_PASSWORD,
            },
            debug: false, 
            logger: false,
        });

        const mailOptions = {
            from: process.env.EMAIL, 
            to: userEmail,
            subject: subject,
            text: message,
        };

        await transporter.sendMail(mailOptions);

        const insertEmailQuery = `
            INSERT INTO SentEmails (sender_email, receiver_email, subject, message, sent_at)
            VALUES ($1, $2, $3, $4, $5)
        `;
        const timestamp = new Date().toISOString();
        
        await db.run(insertEmailQuery, [
            process.env.EMAIL, 
            userEmail, 
            subject, 
            message,
            timestamp
        ]);

    } catch (error) {
        console.error('Error in sendNotificationEmail:', error);
    }
}


router.get('/', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userId = req.session.user.id;

    const currentDate = new Date().toISOString();
    const nextWeekDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const query = `
        SELECT * FROM "Subscriptions"
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

        const insertQuery = `
            INSERT INTO "Notifications" (user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at)
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
        const getExpiryQuery = `SELECT expiry FROM "Subscriptions" WHERE id = $1`;
        const row = await db.get(getExpiryQuery, [subscription_id]);

        if (!row) {
            return res.status(404).json({ success: false, message: 'Subscription not found' });
        }

        const expiry = row.expiry;

        const insertQuery = `
            INSERT INTO "Notifications" (user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        await db.run(insertQuery, [user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at]);
        
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
