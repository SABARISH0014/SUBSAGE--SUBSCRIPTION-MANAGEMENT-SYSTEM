-- Table 1: Users
CREATE TABLE Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
	"reset_token"	TEXT,
	"reset_token_expiry"	INTEGER,
);


-- Table 2: Subscriptions
CREATE TABLE "Subscriptions" (
	"id"	INTEGER,
	"user_id"	INTEGER NOT NULL,
	"name"	TEXT NOT NULL,
	"type"	TEXT,
	"start"	TEXT NOT NULL,
	"expiry"	TEXT NOT NULL,
	"amount"	DECIMAL(10, 2) NOT NULL,
	PRIMARY KEY("id" AUTOINCREMENT),
	FOREIGN KEY("user_id") REFERENCES "Users"("id") ON DELETE CASCADE
);
-- Table 3: Notifications
CREATE TABLE "Notifications" (
	"id"	INTEGER,
	"user_id"	INTEGER NOT NULL,
	"subscription_id"	INTEGER NOT NULL,
	"subscription_name"	TEXT NOT NULL,
	"subscription_type"	TEXT NOT NULL,
	"expiry"	TEXT NOT NULL,
	"message"	TEXT NOT NULL,
	"notified_at"	TEXT NOT NULL,
	PRIMARY KEY("id" AUTOINCREMENT),
	FOREIGN KEY("subscription_id") REFERENCES "Subscriptions"("id"),
	FOREIGN KEY("user_id") REFERENCES "Users"("id")
);
-- Table 4: Contacts
CREATE TABLE "Contacts" (
	"id"	INTEGER,
	"name"	TEXT NOT NULL,
	"email"	TEXT NOT NULL,
	"message"	TEXT NOT NULL,
	PRIMARY KEY("id" AUTOINCREMENT)
);

CREATE TABLE "SentEmails" (
	"id"	INTEGER,
	"sender_email"	TEXT NOT NULL,
	"receiver_email"	TEXT NOT NULL,
	"subject"	TEXT,
	"message"	TEXT,
	"sent_at"	TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY("id" AUTOINCREMENT)
);


CREATE TABLE "Payments" (
	"id"	INTEGER,
	"payment_id"	TEXT NOT NULL UNIQUE,
	"user_id"	INTEGER,
	"subscription_id"	INTEGER,
	"subscription_name"	TEXT,
	"amount"	INTEGER NOT NULL,
	"currency"	TEXT NOT NULL DEFAULT 'inr',
	"status"	TEXT NOT NULL,
	"payment_type"	TEXT NOT NULL,
	"payment_method"	TEXT,
	"latest_charge"	TEXT,
	"payment_intent_id"	TEXT NOT NULL,
	"created_at"	DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY("id" AUTOINCREMENT),
	FOREIGN KEY("subscription_id") REFERENCES "Subscriptions"("id"),
	FOREIGN KEY("user_id") REFERENCES "Users"("id")
);

CREATE TABLE "PayerDetails" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"payment_id" TEXT NOT NULL,
	"user_id" INTEGER,
	"payer_name" TEXT,
	"payer_email" TEXT,
	"address_country" TEXT,
	"created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY("payment_id") REFERENCES "Payments"("payment_id"),
	FOREIGN KEY("user_id") REFERENCES "Users"("id")
);


CREATE TABLE reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT, -- Optional: Link the review to a logged-in user
    name VARCHAR(255) NOT NULL, -- Name of the reviewer
    email VARCHAR(255) NOT NULL, -- Email for reference (optional)
    rating INT CHECK (rating BETWEEN 1 AND 5), -- Rating out of 5
    review_text TEXT NOT NULL, -- User's review
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


PRAGMA foreign_keys = OFF;
-- Perform the deletes
DELETE FROM Notifications;
DELETE FROM Subscriptions;
DELETE FROM Users;
DELETE FROM Contacts;
DELETE FROM SentEmails;
DELETE FROM Payments;
DELETE FROM reviews;
DELETE FROM PayerDetails;
DELETE FROM sqlite_sequence;
PRAGMA foreign_keys = ON;
