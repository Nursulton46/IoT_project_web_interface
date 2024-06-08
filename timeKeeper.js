if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}


const mongoose = require('mongoose');

const dbUrl = process.env.DB_URL;


mongoose.connect(dbUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

mongoose.set('strictQuery', true);

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
    console.log("db connected");
});

const User = require('./models/user');
const mqtt = require('mqtt');

// MQTT broker configuration
const mqttServer = 'mqtt://34.125.161.225:1883';

const mqttOptions = {
    username: 'mqttProj',
    password: 'anbm444555666'
};

// Create MQTT client
const mqttClient = mqtt.connect(mqttServer, mqttOptions);

mqttClient.on('connect', function () {
    console.log('Connected to MQTT broker');
});

mqttClient.on('error', function (error) {
    console.error('Error connecting to MQTT broker:', error);
});


async function scheduler(mqttClient,hour,min) {
    try {
        const users = await User.find(); // Adjust the query if needed
        for (let user of users) {
            const container = user.container;

            for (let btn of container) {
                const dbHourStart=parseInt(btn.start.slice(0,2) )*100
                const dbMinStart=parseInt(btn.start.slice(3,5) )
                const dbHourEnd=parseInt(btn.end.slice(0,2) )*100
                const dbMinEnd=parseInt(btn.end.slice(3,5) )

                if(btn.userChange){
                    if( ( dbHourStart+dbMinStart ) < ( hour*100+min ) && ( dbHourEnd+dbMinEnd < (hour*100+min ) ) ){
                        console.log('starttrrtrt')
                        console.log(parseInt(btn.start.slice(0,2) )*100+parseInt(btn.start.slice(3,5) ))
                        console.log(parseInt(hour)*100+parseInt(min))
                        const mqttMessage = `{${btn.title}: "on"}`
                        mqttClient.publish('ttpu/allTopic', mqttMessage);
                        console.log(`From timer Published MQTT message: ${mqttMessage}`);
                    }else{
                        const mqttMessage = `{${btn.title}: "off"}`
                        mqttClient.publish('ttpu/allTopic', mqttMessage);
                        console.log(`From timer Published MQTT message: ${mqttMessage}`);   
                    }
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
}

function keepschedule(mqttClient) {
    setInterval(async () => {
        const currentTime = new Date();
        const adjustedTime = new Date(currentTime.getTime());
        const hour = adjustedTime.getHours();
        const minute = adjustedTime.getMinutes();
        const formattedHour = (hour < 10 ? '0' : '') + hour;
        const formattedMinute = (minute < 10 ? '0' : '') + minute;

        scheduler(mqttClient,parseInt(hour),parseInt(min))
    },5*1000 ); 
}

// Start the schedulert function to run every 2 minutes
keepschedule(mqttClient);
