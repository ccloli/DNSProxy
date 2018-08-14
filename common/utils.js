
const parseServer = (input) => {
	const init = {
		host: '127.0.0.1',
		port: 53,
		type: 'udp'
	};

	const parseString = (str) => {
		let [server, type] = str.trim().split('@', 2);
		// lookbehind assertions finally added in ECMAScript 2018
		// str.split(/(?<=(?:[0-9.]+|\[[0-9a-fA-F:.]+\])):/)
		// for compatibility, use match instead
		let [, host, port] = server.match(/^([0-9.]+|\[[0-9a-fA-F:.]+\])(?::(\d+))?$/) || [];
		return {
			host,
			port,
			type
		};
	};

	if (typeof input === 'object') {
		let { host, port, type } = input;

		if (!port && /:\d+$/.test(host)) {
			const parsed = parseString(host);
			host = parsed.host || host;
			port = parsed.port || port;
		}
		// the default port of DNS-over-TLS is 853
		if (type === 'tls') {
			init.port = 853;
		}

		return {
			host: host || init.host,
			port: port || init.port,
			type: type || init.type
		};
	}
	else if (typeof input === 'string') {
		const { host, port, type } = parseString(input);
		if (type === 'tls') {
			init.port = 853;
		}
		return {
			host: host || init.host,
			port: port || init.port,
			type: type || init.type
		};
	}
	else {
		return null;
	}
};

const sumBuffer = (buffer) => {
	// correct buffer byte index
	const data = Array.from(buffer).reverse();
	return data.reduce((pre, cur, index) => {
		// pre + cur * (2 ** 8 ** index)
		return pre + cur * Math.pow(1 << 8, index);
	}, 0);
};

const isIPv6 = (ip) => {
	// an IPv6 address has at least two :
	return ip.indexOf(':') !== ip.lastIndexOf(':');
};

const reverseFill = (data) => {
	const list = Object.keys(data);
	list.forEach(key => {
		data[data[key]] = key;
	});
	return data;
};

module.exports = {
	isIPv6,
	parseServer,
	sumBuffer,
	reverseFill
};