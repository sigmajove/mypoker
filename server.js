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
console.log("Number of sockets", io.of("/").sockets.size);

const port = process.env.PORT || 8080;

expressServer.listen(
    port,
    () => console.log(`Server running at ${port}`));

import * as ngrok from "@ngrok/ngrok";

const getUrl = new Promise((resolve) => {
    ngrok.forward({
        addr: 8080,
        authtoken: "2hMl8myT0mtkzDnhNifZRTKOBfX_6EUnMgAJPNVY8HB9fSbHH",
        request_header_add: ["ngrok-skip-browser-warning:true"] // doesn't work
    }).then((listener) => {
        const url = listener.url();
        console.log(`server at ${url}`);
        resolve(url);
    }).catch((error) => {
        throw error;
    });
});

expressApp.get('/', (req, res, next) => {
    getUrl.then((url) =>
        res.render("client", {
            myurl: url
        }));
});

expressApp.post("/refresh", (req, res) => {
    const uuid = req.body.uuid;
    io.sockets.to(uuid).emit("message", allMessages);
    res.send({});
});

let allMessages = "Game server has been reset\n";
const newlines = /\n/g;
const firstline = /.*\n/;

let players = new Map();

function sendMessage(message) {
    const matches = allMessages.match(newlines);
    if (matches !== null && matches.length >= 25) {
        allMessages = allMessages.replace(firstline, "");
    }
    allMessages = allMessages.concat(message, "\n");
    players.forEach((socket, uuid) => {
        socket.emit("message", allMessages);
    });
}

io.on('connection', (socket) => {
    players.set(socket.handshake.auth.uuid, socket);
    sendMessage(`connected ${socket.handshake.auth.uuid}`);
    socket.on('disconnect', () => {
        players.delete(socket.handshake.auth.uuid);
        sendMessage(`disconnected ${socket.handshake.auth.uuid}`);
    });
});
