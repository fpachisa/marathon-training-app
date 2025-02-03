// First, let's verify our Task model (models/Task.js)
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    number: {
        type: Number,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    isTemplate: {
        type: Boolean,
        default: true
    },
    userTasks: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        completed: {
            type: Boolean,
            default: false
        },
        screenshotUrl: String,
        completedAt: Date,
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending'
        },
        feedback: String
    }]
});

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;

// Now, let's create a detailed initialization route with proper error handling
app.get('/admin/initialize-tasks', isAdmin, async (req, res) => {
    try {
        console.log('Starting task initialization...');

        // First, clear existing tasks
        await Task.deleteMany({});
        console.log('Cleared existing tasks');

        // Create default tasks
        const defaultTasks = [
            { number: 1, title: "5K Training Run", description: "Complete a 5K training run at comfortable pace", isTemplate: true },
            { number: 2, title: "Interval Training", description: "Complete 6x400m interval training", isTemplate: true },
            { number: 3, title: "Long Run", description: "Complete a 10K long run", isTemplate: true },
            { number: 4, title: "Recovery Run", description: "30-minute easy recovery run", isTemplate: true },
            { number: 5, title: "Tempo Run", description: "25-minute tempo run at half marathon pace", isTemplate: true },
            { number: 6, title: "Hill Training", description: "Complete 6 hill repeats", isTemplate: true },
            { number: 7, title: "Distance Run", description: "Complete a 15K run", isTemplate: true },
            { number: 8, title: "Speed Work", description: "8x200m sprint intervals", isTemplate: true },
            { number: 9, title: "Peak Long Run", description: "Complete an 18K run", isTemplate: true },
            { number: 10, title: "Final Preparation", description: "10K run at race pace", isTemplate: true }
        ];

        console.log('Attempting to create tasks...');
        
        // Create tasks one by one with error handling
        for (const taskData of defaultTasks) {
            try {
                const task = new Task(taskData);
                await task.save();
                console.log(`Created task ${taskData.number}: ${taskData.title}`);
            } catch (err) {
                console.error(`Error creating task ${taskData.number}:`, err);
                throw err;
            }
        }

        // Verify tasks were created
        const allTasks = await Task.find({ isTemplate: true });
        console.log(`Successfully created ${allTasks.length} tasks`);

        // Send detailed response
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Tasks Initialization</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-50 p-8">
                <div class="max-w-2xl mx-auto bg-white rounded-xl shadow-md p-8">
                    <h1 class="text-2xl font-bold mb-4">Tasks Initialization Status</h1>
                    <div class="mb-4">
                        <p class="text-lg">Number of tasks created: ${allTasks.length}</p>
                    </div>
                    <div class="mb-4">
                        <h2 class="text-xl font-semibold mb-2">Created Tasks:</h2>
                        <div class="space-y-2">
                            ${allTasks.map(task => `
                                <div class="p-2 border rounded">
                                    <p><strong>Task ${task.number}:</strong> ${task.title}</p>
                                    <p class="text-gray-600">${task.description}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="mt-6 flex space-x-4">
                        <a href="/dashboard" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                            Go to Dashboard
                        </a>
                        <a href="/admin/dashboard" class="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">
                            Go to Admin Dashboard
                        </a>
                    </div>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Task initialization error:', error);
        res.status(500).send(`
            <div class="bg-red-100 p-4 rounded">
                <h1 class="text-red-800 font-bold">Error Initializing Tasks</h1>
                <p class="text-red-700">${error.message}</p>
                <pre class="mt-4 bg-red-50 p-2 rounded">${error.stack}</pre>
            </div>
        `);
    }
});