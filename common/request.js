const dgram = require('dgram');
const net = require('net');
const tls = require('tls');
const { isIPv6 } = require('./utils');

const udpLookup = (msg, port, address, timeout) => {
	return new Promise((resolve, reject) => {
		let closed = false;
		let timer;
		const client = dgram.createSocket(isIPv6(address) ? 'udp6' : 'udp4');

		client.on('message', data => {
			client.close();
			resolve(data);
			data = null;
		});
		client.on('close', () => {
			closed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		});
		client.on('error', (err) => {
			msg = null;
			reject(err);
		});
		client.send(msg, port, address, err => {
			msg = null;
			if (err) {
				reject(err);
			}
		});

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.close();
					reject(new Error('No data response'));
				}
			}, timeout);
		}
	});
};

const tcpLookup = (msg, port, address, timeout) => {
	return new Promise((resolve, reject) => {
		let closed = false;
		let timer;
		let length = 0;
		let received = Buffer.alloc(0);

		const client = net.createConnection(port, address, err => {
			if (err) {
				msg = null;
				reject(err);
			}
		});
		client.on('close', () => {
			closed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		});
		client.on('data', data => {
			// record total packet size in case data maybe split
			if (length === 0) {
				// first 2 bytes (packet size) is not included
				length = (data[0] << 8) + data[1] + 2;
			}
			received = Buffer.concat([received, data]);
			data = null;

			if (received.byteLength === length) {
				client.end();
				resolve(received);
				received = null;
			}
		});
		client.on('error', (err) => {
			msg = null;
			reject(err);
		});
		client.write(msg);
		msg = null;

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.close();
					reject(new Error('No data response'));
				}
			}, timeout);
		}
	});
};

const tlsLookup = (msg, port, address, timeout) => {
	return new Promise((resolve, reject) => {
		let closed = false;
		let timer;
		let length = 0;
		let received = Buffer.alloc(0);

		const client = tls.connect(port, address, err => {
			if (err) {
				msg = null;
				reject(err);
			}
		});
		client.on('close', () => {
			closed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		});
		client.on('data', data => {
			// record total packet size in case data maybe split
			if (length === 0) {
				// first 2 bytes (packet size) is not included
				length = (data[0] << 8) + data[1] + 2;
			}
			received = Buffer.concat([received, data]);
			data = null;

			if (received.byteLength === length) {
				// TODO: reuse TLS connection
				//
				// Thought RFC7766 says closing after each request is common, it doesn't
				// say we cannot reuse the connection, and creating a TLS connection takes
				// more time than a normal TCP connection as the client and server needs
				// more steps to handshake.
				//  > 6.1.1.  Clients
				//  >    There is no clear guidance today in any RFC as to when a DNS client
				//  >    should close a TCP connection, and there are no specific
				//  >    recommendations with regard to DNS client idle timeouts.However, at
				//  >    the time of writing, it is common practice for clients to close the
				//  >    TCP connection after sending a single request (apart from the SOA/
				//  >    AXFR case).
				// However we cannot split packets if multiple DNS requests are responsing
				// at this time, and we don't have a good algorithm to make sure when the 
				// socket is idle and can close the connection safely. 
				//  > 6.2.3.  Idle Timeouts
				//  >    To mitigate the risk of unintentional server overload, DNS clients
				//  >    MUST take care to minimise the idle time of established DNS-over-TCP
				//  >    sessions made to any individual server.  DNS clients SHOULD close the
				//  >    TCP connection of an idle session, unless an idle timeout has been
				//  >    established using some other signalling mechanism, for example,
				//  >    [edns-tcp-keepalive].
				// So at this time, we'll close each connection when it responses, but this
				// may makes your other software get confused if it doesn't get response in
				// time. For example, when I testing the TLS lookup with CloudFlare TLS DNS
				// (1.1.1.1:853) using Windows `nslookup`, sometimes I got `DNS request timed 
				// out.	timeout was 2 seconds.`.
				client.end();
				resolve(received);
				received = null;
			}
		});
		client.on('error', (err) => {
			msg = null;
			reject(err);
		});
		client.write(msg);
		msg = null;

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.end();
					reject(new Error('No data response'));
				}
			}, timeout);
		}
	});
};

module.exports = {
	udpLookup,
	tcpLookup,
	tlsLookup
};