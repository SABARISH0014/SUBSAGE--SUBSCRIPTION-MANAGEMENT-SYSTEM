require('dotenv').config();  // Load environment variables from .env file
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt'); // Import bcrypt
const db = require('./database/connection'); // Raw sqlite3 connection
const notificationsRouter = require('./routes/notifications')
const axios = require('axios'); // For making HTTP requests
const nodemailer = require('nodemailer'); // Import nodemailer
const paymentRoutes = require('./routes/payments');
const flash = require('connect-flash');
const crypto = require('crypto'); // For generating secure tokens


const app = express();
const PORT = 3000;


// Middleware for parsing JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Set EJS as the template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Ensure the views folder exists

// Session middleware for handling user sessions
app.use(session({
    secret: 'your-secret-key', // Change to a secure key in production
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Static Files (serve images, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));
// Serve Forgot Password page

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: null });  // Pass message as null initially
});

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL, // Your email address
        pass: process.env.EMAIL_PASSWORD, // Your email password or app password
    }
});

const updateResetToken = (email, token, expireTime) => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE Users SET reset_token = ?, reset_token_expiry = ? WHERE LOWER(email) = ?", 
               [token, expireTime, email.toLowerCase()], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
};

app.post('/forgot-password', async (req, res) => {
    try {
        const { email, 'g-recaptcha-response': recaptchaResponse } = req.body;
        if (!recaptchaResponse) {
            return res.render('forgot-password', { message: 'reCAPTCHA is required.' });
        }

        // Verify reCAPTCHA
        const recaptchaVerifyResponse = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: {
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: recaptchaResponse,
            }
        });

        if (!recaptchaVerifyResponse.data.success) {
            return res.render('forgot-password', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM Users WHERE LOWER(email) = ?", [email.toLowerCase()], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });

        if (!user) {
            return res.render('forgot-password', { message: 'If an account with that email exists, a reset link has been sent.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expireTime = Date.now() + 3600000; // 1-hour expiry

        console.log("Generated Token:", token);
        console.log("Expiry Time:", expireTime);

        const updatedRows = await updateResetToken(email, token, expireTime);
        console.log("Rows updated:", updatedRows);

        if (updatedRows === 0) {
            return res.render('forgot-password', { message: 'Error updating reset token. Please try again.' });
        }

        const resetLink = `http://localhost:3000/reset-password?token=${token}&email=${email}`;
        console.log("Reset Link:", resetLink);

        const mailOptions = {
            from: process.env.EMAIL,
            to: email,
            subject: 'Password Reset',
            text: `Click the link to reset your password: ${resetLink}`
        };

        transporter.sendMail(mailOptions, (emailErr) => {
            if (emailErr) {
                console.error("Error sending email:", emailErr);
                return res.render('forgot-password', { message: 'Error sending email. Please try again later.' });
            }
            res.render('forgot-password', { message: 'If an account with that email exists, a reset link has been sent.' });
        });

    } catch (error) {
        console.error("Error:", error);
        return res.render('forgot-password', { message: 'An error occurred. Please try again later.' });
    }
});




// Render reset password page
app.get('/reset-password', (req, res) => {
    const { token, email } = req.query; // Get token and email from query params

    if (!token || !email) {
        return res.status(400).send("Invalid or missing parameters.");
    }

    res.render('reset-password', { token, email, message: null });
});

// Handle password reset
app.post('/reset-password', async (req, res) => {
    const { token, email, password, 'g-recaptcha-response': recaptchaResponse } = req.body;

    if (!recaptchaResponse) {
        return res.render('reset-password', { token, email, message: 'reCAPTCHA is required.' });
    }

    try {
        // Verify reCAPTCHA
        const recaptchaVerifyResponse = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: {
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: recaptchaResponse,
            }
        });

        if (!recaptchaVerifyResponse.data.success) {
            return res.render('reset-password', { token, email, message: 'reCAPTCHA verification failed. Please try again.' });
        }

        // Check if the token exists and is not expired
        db.get("SELECT * FROM Users WHERE reset_token = ? AND reset_token_expiry > ?", 
               [token, Date.now()], async (err, user) => {
            if (err) {
                console.error(err);
                return res.render('reset-password', { token, email, message: 'Database error. Please try again.' });
            }
            if (!user) {
                return res.render('reset-password', { token, email, message: 'Invalid or expired token.' });
            }

            // Hash the new password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Update the password and clear the reset token
            db.run("UPDATE Users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?", 
                   [hashedPassword, user.id], (updateErr) => {
                if (updateErr) {
                    console.error(updateErr);
                    return res.render('reset-password', { token, email, message: 'Error updating password. Please try again.' });
                }

                // Redirect or show success message
                res.render('reset-password', { token, email, message: 'Password updated successfully. Please log in with your new password.' });
            });
        });
    } catch (error) {
        console.error(error);
        return res.render('reset-password', { token, email, message: 'Error verifying reCAPTCHA. Please try again later.' });
    }
});


app.use('/notifications', notificationsRouter);


// Route to handle the redirection and render addsubscriptions.ejs

// Routes for serving HTML files (static)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/signup', (req, res) => {
    res.render('signup', { message: null });  // Pass message as null initially
});

app.post('/auth/signup', async (req, res) => {
    const { email, username, password, 'g-recaptcha-response': reCAPTCHAResponse } = req.body;

    if (!reCAPTCHAResponse) {
        return res.render('signup', { message: 'reCAPTCHA is required.' });
    }

    try {
        // Verify reCAPTCHA
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const verificationResponse = await axios.post(verificationUrl, null, {
            params: {
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: reCAPTCHAResponse
            }
        });

        if (!verificationResponse.data.success) {
            return res.render('signup', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        // Check if the user already exists
        db.get('SELECT id FROM Users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.render('signup', { message: 'Database error. Please try again.' });
            }

            if (row) {
                return res.render('signup', { message: 'User already exists.' });
            }

            // Hash password and save user
            const hashedPassword = await bcrypt.hash(password, 10);
            db.run('INSERT INTO Users (email, username, password) VALUES (?, ?, ?)', [email, username, hashedPassword], function (err) {
                if (err) {
                    console.error('Error saving user:', err.message);
                    return res.render('signup', { message: 'Error saving user data.' });
                }

                return res.render('signup', { message: 'User registered successfully. You can now log in!' });
            });
        });

    } catch (error) {
        console.error('Error verifying reCAPTCHA:', error.message);
        res.render('signup', { message: 'Error verifying reCAPTCHA. Please try again later.' });
    }
});
app.get('/login', (req, res) => {
    res.render('login', { message: null });  // Pass message as null initially
});
app.post('/auth/login', async (req, res) => {
    const { username, password, 'g-recaptcha-response': reCAPTCHAResponse } = req.body;

    if (!reCAPTCHAResponse) {
        return res.render('login', { message: 'reCAPTCHA is required.' });
    }

    try {
        // Verify reCAPTCHA
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const verificationResponse = await axios.post(verificationUrl, null, {
            params: {
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: reCAPTCHAResponse
            }
        });

        if (!verificationResponse.data.success) {
            return res.render('login', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        // Check user credentials
        db.get('SELECT * FROM Users WHERE username = ?', [username], async (err, row) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.render('login', { message: 'Database error. Please try again.' });
            }

            if (!row || !(await bcrypt.compare(password, row.password))) {
                return res.render('login', { message: 'Invalid username or password.' });
            }

            // Store user session
            req.session.user = { id: row.id, username: row.username };
            console.log('User logged in:', req.session.user);

            // Redirect instead of rendering dashboard
            return res.redirect('/dashboard');
        });

    } catch (error) {
        console.error('Error verifying reCAPTCHA:', error.message);
        res.render('login', { message: 'Error verifying reCAPTCHA. Please try again later.' });
    }
});



// Use the payment routes
app.use('/payments', paymentRoutes);
app.get('/transaction-history', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Redirect if user is not logged in
    }

    const userId = req.session.user.id; // Corrected user ID reference

    const sql = `
        SELECT 
            p.payment_id, p.subscription_name, p.amount, p.currency, 
            p.status, p.payment_method, p.payment_type, p.created_at,  -- Added p.payment_type
            pd.payer_name, pd.payer_email
        FROM Payments p
        LEFT JOIN PayerDetails pd ON p.payment_id = pd.payment_id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
    `;

    db.all(sql, [userId], (err, transactions) => {
        if (err) {
            console.error("Error fetching transaction history:", err.message);
            return res.status(500).send("Error loading transaction history");
        }

        console.log("Transactions fetched:", transactions); // Debugging log
        res.render('transaction-history', { transactions });
    });
});

app.get('/transaction-details/:paymentId', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Redirect if user is not logged in
    }

    const paymentId = req.params.paymentId;
    const userId = req.session.user.id; // Ensure users can only view their own transactions

    const sql = `
        SELECT 
            p.payment_id, p.subscription_name, p.amount, p.currency, 
            p.status, p.payment_method, p.payment_type, p.created_at,  
            pd.payer_name, pd.payer_email
        FROM Payments p
        LEFT JOIN PayerDetails pd ON p.payment_id = pd.payment_id
        WHERE p.payment_id = ? AND p.user_id = ?  -- Restrict to logged-in user's transactions
    `;

    db.get(sql, [paymentId, userId], (err, transaction) => {
        if (err) {
            console.error("Error fetching transaction details:", err.message);
            return res.status(500).send("Error loading transaction details");
        }

        if (!transaction) {
            return res.status(404).send("Transaction not found or unauthorized access");
        }

        res.render('transaction-details', { transaction });
    });
});


app.get('/entertainment', (req, res) => res.sendFile(path.join(__dirname, 'views', 'entertainment.html')));
app.get('/utilities', (req, res) => res.sendFile(path.join(__dirname, 'views', 'utilities.html')));
// Serve the contact page (contact.ejs)
// Combined GET route for /contact
// Middleware to set success messages
// Middleware to set success messages and clear them after use
app.use((req, res, next) => {
    res.locals.successMessageContact = req.session.successMessageContact || null;
    res.locals.successMessageReview = req.session.successMessageReview || null;

    delete req.session.successMessageContact;
    delete req.session.successMessageReview;

    next();
});

app.get('/contact', async (req, res) => {
    try {
        db.all(
            'SELECT name, rating, review_text, created_at FROM reviews ORDER BY created_at DESC LIMIT 4',
            (err, rows) => {
                if (err) {
                    console.error('Error fetching reviews:', err);
                    return res.status(500).send('An error occurred while loading reviews.');
                }

                res.render('contact', {
                    reviews: rows,
                    successMessageContact: res.locals.successMessageContact,
                    successMessageReview: res.locals.successMessageReview
                });
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('An error occurred while loading the contact page.');
    }
});

// Handle contact form submission
app.post('/submit-contact', (req, res) => {
    const { name, email, message } = req.body;
    const query = `INSERT INTO Contacts (name, email, message) VALUES (?, ?, ?)`; 

    db.run(query, [name, email, message], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Failed to save message');
        }
        req.session.successMessageContact = 'Your message has been sent successfully!';
        res.redirect('/contact');
    });
});

// Handle review form submission
app.post('/submit-review', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/contact');
    }

    const { id: userId } = req.session.user;
    const { name, email, rating, review_text } = req.body;

    if (!email || !rating || !review_text) {
        return res.redirect('/contact');
    }

    const query = `INSERT INTO reviews (user_id, name, email, rating, review_text) VALUES (?, ?, ?, ?, ?)`; 

    db.run(query, [userId, name, email, rating, review_text], function (err) {
        if (err) {
            console.error('Error submitting review:', err);
            return res.redirect('/contact');
        }
        req.session.successMessageReview = 'Your review has been submitted successfully!';
        res.redirect('/contact');
    });
});

app.get('/addSubscription', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Redirect to login if not authenticated
    }

    const user = req.session.user; // Get user data from session
    const name = req.query.name || ''; // Get 'name' from query or default to empty string
    const type = req.query.type || ''; // Get 'type' from query or default to empty string

    // Render the addSubscription view with user, name, and type
    res.render('addSubscription', { user: user, name: name, type: type });
});


// Route for rendering addSubscription (possibly without authentication)
app.get('/add-subscription', (req, res) => {
    const name = req.query.name || ''; // Get the 'name' from query or default to empty string
    res.render('addSubscription', { name: name }); // Only pass name, you can add user here if needed
});

// Routes for managing subscriptions (update and delete)
app.get('/manage-subscriptions', (req, res) => {
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
        res.render('manage-subscriptions', { subscriptions: rows }); // Render manage-subscriptions.ejs with subscription data
    });
});

// GET route to render the edit form with subscription data
app.get('/subscriptions/update/:id', (req, res) => {
    const query = 'SELECT * FROM Subscriptions WHERE id = ?';
    db.get(query, [req.params.id], (err, row) => {
        if (err) {
            console.error('Error fetching subscription:', err.message);
            return res.status(500).send('Error fetching subscription');
        }

        if (!row) {
            return res.status(404).send('Subscription not found');
        }
        res.render('update-subscription', { subscription: row }); // Render form with current subscription data
    });
});

// POST route to update subscription in the database
app.post('/subscriptions/update/:id', (req, res) => {
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
        res.redirect('/manage-subscriptions'); // Redirect back to the subscriptions list
    });
});

// DELETE route to delete a subscription by ID
app.get('/subscriptions/delete/:id', (req, res) => {
    const query = 'DELETE FROM Subscriptions WHERE id = ?';

    db.run(query, [req.params.id], function (err) {
        if (err) {
            console.error('Error deleting subscription:', err.message);
            return res.status(500).send('Error deleting subscription');
        }
        res.redirect('/manage-subscriptions'); // Redirect back to the subscriptions list
    });
});

// POST request to add a subscription
app.post('/subscriptions/add', (req, res) => {
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

    // SQL query to insert the subscription
    const query = `INSERT INTO Subscriptions (user_id, name, type, start, expiry, amount) VALUES (?, ?, ?, ?, ?, ?)`;

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

app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    // Query for subscription data (number of active subscriptions per month per subscription)
    db.all(`
        SELECT strftime('%m', start) AS month, name, COUNT(*) AS count
        FROM Subscriptions
        WHERE user_id = ?
        GROUP BY month, name
        ORDER BY month;
    `, [req.session.user.id], (err, subscriptionResults) => {
        if (err) {
            console.error("Error fetching subscription data:", err);
            return res.status(500).send("Database error");
        }

        // Query for payment data (total payments per month per subscription)
        db.all(`
            SELECT strftime('%m', created_at) AS month, subscription_name, SUM(amount) AS amount
            FROM Payments
            WHERE user_id = ?
            GROUP BY month, subscription_name
            ORDER BY month;
        `, [req.session.user.id], (err, paymentResults) => {
            if (err) {
                console.error("Error fetching payment data:", err);
                return res.status(500).send("Database error");
            }

            // Query for unique payers (distinct payer emails)
            db.get(`
                SELECT COUNT(DISTINCT payer_email) AS uniquePayers
                FROM PayerDetails
                WHERE user_id = ?;
            `, [req.session.user.id], (err, payerResults) => {
                if (err) {
                    console.error("Error fetching payer data:", err);
                    return res.status(500).send("Database error");
                }

                // Render the dashboard with properly formatted data
                res.render('dashboard', {
                    username: req.session.user.username,
                    message: req.session.message,
                    subscriptionData: subscriptionResults,
                    paymentData: paymentResults,
                    uniquePayers: payerResults ? payerResults.uniquePayers : 0
                });

                req.session.message = null; // Clear message after rendering
            });
        });
    });
});

// Notification route
app.get('/notifications', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Redirect to login if not authenticated
    }

    const userId = req.session.user.id; // User ID from session
    const currentDate = new Date();
    const nextWeekDate = new Date();
    nextWeekDate.setDate(currentDate.getDate() + 7); // 7 days from today

    // Query to fetch subscriptions expiring within the next 7 days
    const query = `
        SELECT * FROM Subscriptions
        WHERE user_id = ? AND expiry BETWEEN ? AND ?
    `;

    db.all(query, [userId, currentDate.toISOString(), nextWeekDate.toISOString()], (err, subscriptions) => {
        if (err) {
            console.error('Error fetching subscriptions:', err.message);
            return res.status(500).send('Error fetching subscriptions');
        }

        // Create notification data
        const notifications = subscriptions.map(subscription => {
            return {
                subscription_id: subscription.id,
                subscription_name: subscription.name,
                subscription_type: subscription.type,
                message: `Your subscription to ${subscription.name} will expire soon!`,
                notified_at: new Date().toISOString()  // Timestamp for notification
            };
        });

        res.render('notifications', { notifications }); // Render notifications.ejs with notifications data
    });
});

// Import route files (ensure routes match your API logic)
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');

// Use route handlers
app.use('/auth', authRoutes); // This will handle signup and login routes
app.use('/subscriptions', subscriptionRoutes);
app.use('/notifications', notificationsRouter);

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Error logging out');
        }
        res.redirect('/'); // Redirect to the home page after logout
    });
});

// Error handling for unmatched routes
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
