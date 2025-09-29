const express = require('express');
const db = require('../database/connection');
const nodemailer = require('nodemailer');
const router = express.Router();


async function sendNotificationEmail(userId, subscription) {
    try {
        // Fetch user email from the Users table
        const query = 'SELECT email FROM Users WHERE id = ?';
        db.get(query, [userId], async (err, row) => {
            if (err) {
                console.error('Error fetching user email:', err.message);
                return;
            }

            if (!row) {
                console.log('User not found');
                return;
            }

            const userEmail = row.email; // The user's email address
            const subject = `Subscription Expiring Soon: ${subscription.subscription_name}`;
            const message = `Hello,\n\nYour subscription to ${subscription.subscription_name} is expiring soon on ${subscription.expiry}.\nPlease renew it to continue enjoying the benefits.\n\nBest regards,\nSubSage`;

            // Set up the SMTP transport using your email provider (example with Gmail)
            const transporter = nodemailer.createTransport({
                service: 'gmail', // Example with Gmail
                auth: {
                    user: process.env.EMAIL, // Your email address
                    pass: process.env.EMAIL_PASSWORD, // Your email password or app password
                },
                debug: true,  // Enable debug for detailed logs
                logger: true, // Logs to console
            });

            // Email message options
            const mailOptions = {
                from: process.env.EMAIL, // The "from" address
                to: userEmail, // The recipient's email address
                subject: subject, // Subject of the email
                text: message, // Plain text body
            };

            // Send the email
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error sending email:', error);
                } else {
                    console.log('Email sent: ' + info.response);

                    // Insert email details into the SentEmails table after email is sent
                    const insertEmailQuery = `
                        INSERT INTO SentEmails (sender_email, receiver_email, subject, message, sent_at)
                        VALUES (?, ?, ?, ?, ?)
                    `;
                    const timestamp = new Date().toISOString();
                    db.run(insertEmailQuery, [
                        process.env.EMAIL, // Sender email
                        userEmail,          // Receiver email
                        subject,            // Email subject
                        message,            // Email body
                        timestamp          // Timestamp when the email was sent
                    ], (err) => {
                        if (err) {
                            console.error('Error saving email details:', err.message);
                        } else {
                            console.log('Email details saved to database.');
                        }
                    });
                }
            });
        });
    } catch (error) {
        console.error('Error sending notification email:', error.message);
    }
}
// Route to fetch notifications for subscriptions expiring in the next 7 days
router.get('/', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');  // Redirect to login if user is not authenticated
    }

    const userId = req.session.user.id; // Get the user ID from the session

    // Get current date and the date one week from now
    const currentDate = new Date();
    const nextWeekDate = new Date();
    nextWeekDate.setDate(currentDate.getDate() + 7); // Set the date for one week from now

    // Format the dates in ISO format to match the database format
    const currentDateISOString = currentDate.toISOString();
    const nextWeekDateISOString = nextWeekDate.toISOString();

    // Query to fetch subscriptions that are expiring between today and in 7 days
    const query = `
        SELECT * FROM Subscriptions
        WHERE user_id = ? AND expiry BETWEEN ? AND ?
    `;

    db.all(query, [userId, currentDateISOString, nextWeekDateISOString], (err, subscriptions) => {
        if (err) {
            console.error('Error fetching subscriptions:', err.message);
            return res.status(500).send('Error fetching subscriptions');
        }

        // If there are subscriptions expiring soon, create notifications
        const notifications = subscriptions.map(subscription => {
            return {
                user_id: userId,
                subscription_id: subscription.id,
                subscription_name: subscription.name,  // Add subscription name
                subscription_type: subscription.type,  // Add subscription type
                expiry: subscription.expiry,  // Add the actual expiry date from the subscription
                message: `Your subscription to ${subscription.name} will expire soon!`,
                notified_at: new Date().toISOString(),  // Current timestamp for notification
            };
        });

        // Optionally: Store these notifications in the database
        const insertQuery = `
            INSERT INTO Notifications (user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        notifications.forEach(notification => {
            db.run(insertQuery, [
                notification.user_id, 
                notification.subscription_id, 
                notification.subscription_name, 
                notification.subscription_type, 
                notification.expiry, 
                notification.message, 
                notification.notified_at,
            ], function (err) {
                if (err) {
                    console.error('Error saving notification:', err.message);
                    return res.status(500).send('Error saving notification');
                }

                // Send email notification after storing in database
                sendNotificationEmail(notification.user_id, notification);
            });
        });

        // Render the notifications.ejs page with the generated notifications
        res.render('notifications', { notifications });
    });
});

// Route to store a new notification (for example, when a subscription expires)
router.post('/store', (req, res) => {
    const { user_id, subscription_id, subscription_name, subscription_type, message, notified_at } = req.body;

    // Validate the data
    if (!user_id || !subscription_id || !subscription_name || !subscription_type || !message || !notified_at) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Get the expiry date for the subscription
    const getExpiryQuery = `SELECT expiry FROM Subscriptions WHERE id = ?`;
    db.get(getExpiryQuery, [subscription_id], (err, row) => {
        if (err) {
            console.error('Error fetching subscription expiry:', err.message);
            return res.status(500).json({ success: false, message: 'Error fetching subscription expiry' });
        }
        if (!row) {
            return res.status(404).json({ success: false, message: 'Subscription not found' });
        }

        const expiry = row.expiry;

        // Insert the new notification into the Notifications table
        const insertQuery = `
            INSERT INTO Notifications (user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(insertQuery, [user_id, subscription_id, subscription_name, subscription_type, expiry, message, notified_at], function (err) {
            if (err) {
                console.error('Error saving notification:', err.message);
                return res.status(500).json({ success: false, message: 'Error saving notification' });
            }

            // Send email notification after storing the notification
            sendNotificationEmail(user_id, {
                name: subscription_name,
                expiry: expiry,
            });

            res.status(200).json({ success: true, message: 'Notification saved and email sent successfully' });
        });
    });
});

module.exports = router;  // Export the router to use in app.js
