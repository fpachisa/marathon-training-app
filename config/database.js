const mongoose = require('mongoose');
const Task = require('../models/Task');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected successfully');
        
        // Create initial tasks if they don't exist
        const tasksCount = await Task.countDocuments();
        if (tasksCount === 0) {
            const defaultTasks = [
                { number: 1, title: "5K Training Run", description: "Complete a 5K training run at comfortable pace" },
                { number: 2, title: "Interval Training", description: "Complete 6x400m interval training" },
                { number: 3, title: "Long Run", description: "Complete a 10K long run" },
                { number: 4, title: "Recovery Run", description: "30-minute easy recovery run" },
                { number: 5, title: "Tempo Run", description: "25-minute tempo run at half marathon pace" },
                { number: 6, title: "Hill Training", description: "Complete 6 hill repeats" },
                { number: 7, title: "Distance Run", description: "Complete a 15K run" },
                { number: 8, title: "Speed Work", description: "8x200m sprint intervals" },
                { number: 9, title: "Peak Long Run", description: "Complete an 18K run" },
                { number: 10, title: "Final Preparation", description: "10K run at race pace" }
            ];
            await Task.insertMany(defaultTasks);
            console.log('Default tasks created');
        }
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

module.exports = { connectDB };