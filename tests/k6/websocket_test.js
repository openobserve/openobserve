import ws from 'k6/ws';
import { check, sleep } from 'k6';

export default function () {
    const url = 'wss://main.dev.zinclabs.dev/api/default/ws/52e527c8-91c3-49cc-b4d6-4f06257071b1';
    
    const params = {
        headers: {
            'Upgrade': 'websocket',
            'Origin': 'https://main.dev.zinclabs.dev',
            'Cache-Control': 'no-cache',
            'Accept-Language': 'en-US,en;q=0.9',
            'Pragma': 'no-cache',
            'Cookie': 'auth_ext={"auth_ext":"","refresh_token":"","request_time":0,"expires_in":0}; _ga=GA1.1.1388396574.1737697562; auth_tokens={"access_token":"Basic YUBhaS5haToxMjM0NTY3OA==","refresh_token":""}; _ga_89WN60ZK2E=GS1.1.1738545012.27.0.1738545012.0.0.0',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Key': '6cka9/EbsHoxlL5DyWgzQA==',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
        },
    };

    const res = ws.connect(url, params, function (socket) {
        console.log('Connected to WebSocket');

        socket.on('open', function () {
            console.log('WebSocket connection opened');
            // You can send messages here if needed
            // socket.send(JSON.stringify({"your": "message"}));
        });

        socket.on('message', function (message) {
            console.log('Received message: ', message);
        });

        socket.on('close', function () {
            console.log('WebSocket connection closed');
        });

        socket.on('error', function (error) {
            console.log('WebSocket error: ', error);
        });

        // Keep the connection open for a while
        sleep(10); // Adjust the sleep time as needed

        socket.close();
    });

    check(res, {
        'WebSocket connection established': (r) => r && r.status === 101,
    });
}
