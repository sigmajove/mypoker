import express from 'express';
import {
    Server as socketIoServer
} from "socket.io";

import {
    createServer as httpCreateServer
} from "node:http";

import {
    Liquid
} from 'liquidjs';

const liquidEngine = new Liquid();

const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.urlencoded({
    extended: true
}));
expressApp.use(express.static('public'));
expressApp.engine('liquid', liquidEngine.express());
expressApp.set('views', './views');
expressApp.set('view engine', 'liquid')

const expressServer = httpCreateServer(expressApp);
const io = new socketIoServer(expressServer);

const port = process.env.PORT || 8080;

expressServer.listen(
    port,
    () => {
        const now = new Date();
        const pstNow = now.toLocaleString("en-US", {
            timeZone: "America/Los_Angeles"
        });
        console.log(`Server started at ${pstNow.toString()} (California time)`);
        console.log(`Server listening on ${port}`)
    });

expressApp.get('/', (req, res) => {
    res.render("client", {
        myurl: `${req.protocol}://${req.get('host')}`
    });
});


let idCounter = 0;
expressApp.post("/getid", (req, res) => {
    idCounter += 1;
    res.send({
        id: idCounter
    });
});


// A player is a object with the the following properties.
//   player: string  (Every player object has one)
//   score: number
//   uuid: string  (Only players in the game have one.)
//   socket: a socket.io socket  (Only players in the game have one.)

// The players, in the order in which they take turns.
// Conceptually, the order is circular.
let players = [];

// These are sockets that have been created but might not have listeners.
const pendingSockets = new Map();

// Sockets that have listeners, but are not yet attached to players.
const newSockets = new Map();

// A generator that allows iterating over all sockets with listeners.
function* allSockets() {
    for (const socket of newSockets.values()) {
        yield socket;
    }
    for (const obj of players) {
        if (obj.socket !== undefined) {
            yield obj.socket;
        }
    }
}

// Wait for a socket with the given id to show in pendingSockets.
function waitForSocket(socketId) {
    return new Promise(resolve => {
        const timer = setInterval(() => {
            let socket = pendingSockets.get(socketId);
            if (socket !== undefined) {
                clearInterval(timer);
                resolve(socket);
            }
        }, 30);
    });
}

// Start sending messages to the socket.
expressApp.post("/enable", (req, res) => {
    const socketId = req.body.socketId;
    waitForSocket(socketId).then((socket) => {
        pendingSockets.delete(socketId);
        newSockets.set(socketId, socket);
        socket.emit("message", allMessages);
        socket.emit("update", playerState());
        res.send({});
    })
});

// Returns a list of that have become disconnected.
expressApp.post("/disconnected", (req, res) => {
    res.send({
        disconnected: players.filter((obj) => obj.uuid === undefined)
            .map((obj) => obj.player)
    });
});

expressApp.post("/setname", (req, res) => {
    const uuid = req.body.uuid;
    const player = req.body.player;
    const socket = newSockets.get(uuid);

    if (socket === undefined) {
        const errorMessage = `Missing socket id ${uuid}`;
        console.error(errorMessage);
        res.send({
            error: errorMessage
        });
        return;
    }

    // See if there is already a slot for the player.
    const obj = players.find((obj) => obj.player == player);
    if (obj === undefined) {
        // Create a new slot for the player.
        players.push({
            player: player,
            score: 0,
            uuid: uuid,
            socket: socket
        });
        newSockets.delete(uuid);
        sendMessage(`${player} has joined the game.`);
        sendUpdate();
        res.send({
            player: player
        });
        return;
    }
    if (obj.uuid === undefined) {
        // A player who left the game has returned.
        obj.uuid = uuid;
        obj.socket = socket;
        newSockets.delete(uuid);
        sendMessage(`${player} has returned to the game.`);
        sendUpdate();
        res.send({
            player: player
        });
    } else {
        // The requested name is being used by somebody else.
        // The requester needs to pick new name.
        res.send({
            inuse: player
        })
    }
});

expressApp.post("/sendmessage", (req, res) => {
    sendMessage(req.body.message);
    res.send({});
});

let allMessages = "Game server has been reset.\n";
const newlines = /\n/g;
const firstline = /.*\n/;

function sendMessage(message) {
    const matches = allMessages.match(newlines);
    if (matches !== null && matches.length >= 25) {
        allMessages = allMessages.replace(firstline, "");
    }
    allMessages = allMessages.concat(message, "\n");
    for (const socket of allSockets()) {
        socket.emit("message", allMessages);
    }
}

function playerState() {
    return players.filter((obj) => obj.uuid !== undefined).
        map((obj) => ({
            player: obj.player,
            score: obj.score
        }));
}

function sendUpdate() {
    const update = playerState();
    for (const socket of allSockets()) {
        socket.emit("update", update);
    }
}

io.on('connection', (socket) => {
    const socketId = socket.handshake.auth.socketId;
    socket.on('disconnect', () => {
        pendingSockets.delete(socketId);
        newSockets.delete(socketId);
        const obj = players.find((obj) => obj.uuid == socketId);
        if (obj !== undefined) {
            delete obj.uuid;
            delete obj.socket;
            sendMessage(`${obj.player} has left the game.`);
            sendUpdate();
        }
    });

    // Save the newly created socket in newSockets.
    // It will be get transferred to players by /setname.
    pendingSockets.set(socketId, socket);
});
