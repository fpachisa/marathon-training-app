// middleware/isAdmin.js
const isAdmin = async (req, res, next) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }
    
    // Check if user's email is in the admin list
    const adminEmails = process.env.ADMIN_EMAILS.split(',');
    if (!adminEmails.includes(req.user.email)) {
        return res.status(403).send('Access denied');
    }
    
    next();
};

module.exports = isAdmin;

// routes/admin.js
const express = require('express');
const router = express.Router();
const isAdmin = require('../middleware/isAdmin');
const Task = require('../models/Task');
const User = require('../models/User');

// Admin dashboard
router.get('/dashboard', isAdmin, async (req, res) => {
    try {
        // Get all completed tasks with user information
        const completedTasks = await Task.aggregate([
            {
                $match: { completed: true }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $sort: { completedAt: -1 }
            }
        ]);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Dashboard</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .task-card { 
                        border: 1px solid #ddd; 
                        margin: 10px 0; 
                        padding: 15px;
                        border-radius: 5px;
                    }
                    .screenshot { max-width: 200px; }
                    .status-pending { color: orange; }
                    .status-approved { color: green; }
                    .status-rejected { color: red; }
                </style>
            </head>
            <body>
                <h1>Admin Dashboard</h1>
                <div>
                    ${completedTasks.map(task => `
                        <div class="task-card">
                            <h3>Task ${task.number}: ${task.title}</h3>
                            <p><strong>User:</strong> ${task.user.displayName} (${task.user.email})</p>
                            <p><strong>Completed:</strong> ${new Date(task.completedAt).toLocaleString()}</p>
                            ${task.screenshotUrl ? 
                                `<img src="${task.screenshotUrl}" alt="Task Screenshot" class="screenshot"/>` : 
                                'No screenshot available'}
                            <div>
                                <form action="/admin/review-task/${task._id}" method="POST" style="margin-top: 10px;">
                                    <select name="status" required>
                                        <option value="approved">Approve</option>
                                        <option value="rejected">Reject</option>
                                    </select>
                                    <textarea name="feedback" placeholder="Provide feedback" style="margin: 10px 0;"></textarea>
                                    <button type="submit">Submit Review</button>
                                </form>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).send('Error loading admin dashboard');
    }
});

// Handle task review
router.post('/review-task/:taskId', isAdmin, async (req, res) => {
    try {
        const { taskId } = req.params;
        const { status, feedback } = req.body;
        
        const task = await Task.findByIdAndUpdate(taskId, {
            status,
            feedback,
            reviewedAt: new Date(),
            reviewedBy: req.user._id
        });

        // Send email notification to user about the review
        const user = await User.findById(task.userId);
        await sendTaskReviewEmail(user, task, status, feedback);

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Review submission error:', error);
        res.status(500).send('Error submitting review');
    }
});

module.exports = router;