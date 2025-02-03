// config/email.js
const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD // Gmail App Password
    }
});

// Function to send notification email
const sendTaskCompletionEmail = async (user, task, screenshotUrl) => {
    const fullScreenshotUrl = `http://localhost:3000${screenshotUrl}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.ADMIN_EMAIL,
        subject: `Task Completed: ${task.title}`,
        html: `
            <h2>Task Completion Notification</h2>
            <p><strong>User:</strong> ${user.displayName} (${user.email})</p>
            <p><strong>Task:</strong> ${task.title}</p>
            <p><strong>Description:</strong> ${task.description}</p>
            <p><strong>Completed At:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Screenshot:</strong> <a href="${fullScreenshotUrl}">View Screenshot</a></p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Task completion email sent successfully');
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

module.exports = { sendTaskCompletionEmail };