import express from 'express';
import {
    Server
} from "socket.io";

// Nonsense to get the current directory so that the express sendFile
// function will work.
import path from 'node:path';
import {
    fileURLToPath
} from 'node:url';

import {
    createServer
} from "node:http";

import { Liquid } from 'liquidjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = process.env.PORT || 8080;
const engine = new Liquid();

const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.urlencoded({
    extended: true
}));
expressApp.use(express.static('public'));
expressApp.engine('liquid', engine.express());
expressApp.set('views', './views');
expressApp.set('view engine', 'liquid')

const expressServer = createServer(expressApp);
const io = new Server(expressServer);

expressServer.listen(
    port,
    () => console.log(`Server running at ${port}`));

import * as ngrok from "@ngrok/ngrok";

const getUrl = new Promise((resolve) => {
    ngrok.forward({
        addr: 8080,
        authtoken: "2hMl8myT0mtkzDnhNifZRTKOBfX_6EUnMgAJPNVY8HB9fSbHH"
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

let allMessages = "";
const newlines = /\n/g;
const firstline = /.*\n/;

function sendMessage(message, socket) {
    const matches = contents.allMessages(allMessages);
    if (matches !== null && matches.length >= 25) {
        allMessages = allMessages.replace(firstline, "");
    }
    allMessages = contents.concat(messages, "\n");
    socket.broadcast.emit("message", message);
}

io.on('connection', (socket) => {
    console.log(`connected ${socket.handshake.auth.uuid}`);
    socket.on('disconnect', () => {
        console.log(`disconnected ${socket.handshake.auth.uuid}`);
    });
});
