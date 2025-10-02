const nodemailer = require('nodemailer');
const db = require('../database/connection'); 

/**
 * Creates and returns a nodemailer transporter instance using environment variables.
 */
function createEmailTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,
            pass: process.env.EMAIL_PASSWORD,
        }
    });
}

/**
 * Sends a notification email to a user about an expiring subscription and logs the send event.
 * @param {number} userId - The ID of the user.
 * @param {object} subscription - The subscription details.
 */
const sendNotificationEmail = async function (userId, subscription) {
    try {
        // 1. Fetch user email
        const userRow = await db.get('SELECT email FROM users WHERE id = $1', [userId]);

        if (!userRow) { 
            console.warn(`User ID ${userId} not found for notification.`);
            return; 
        }

        const userEmail = userRow.email;
        const subject = `Subscription Expiring Soon: ${subscription.subscription_name}`;
        const message = `Hello,\n\nYour subscription to ${subscription.subscription_name} is expiring soon on ${subscription.expiry}.\nPlease renew it to continue enjoying the benefits.\n\nBest regards,\nSubSage`;

        // 2. Send email
        const transporter = createEmailTransporter();

        const mailOptions = {
            from: process.env.EMAIL, 
            to: userEmail, 
            subject: subject, 
            text: message,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Notification email sent to ${userEmail} for ${subscription.subscription_name}`);

        // 3. Log the sent email
        const insertEmailQuery = `
INSERT INTO sentemails (sender_email, receiver_email, subject, message, sent_at)
VALUES ($1, $2, $3, $4, $5)
`;
        const timestamp = new Date().toISOString();

        await db.run(insertEmailQuery.trim(), [
            process.env.EMAIL, userEmail, subject, message, timestamp
        ]);

    } catch (error) {
        console.error('Error in sendNotificationEmail:', error);
    }
};

module.exports = { createEmailTransporter, sendNotificationEmail };
