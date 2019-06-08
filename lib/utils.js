let localIPs = null;

const parseServer = (input) => {
	const init = {
		host: '127.0.0.1',
		port: 53,
		type: null
	};

	const parseString = (str) => {
		let [server, type] = str.trim().split('@', 2);
		// lookbehind assertions finally added in ECMAScript 2018
		// str.split(/(?<=(?:[0-9.]+|\[[0-9a-fA-F:.]+\])):/)
		// for compatibility, use match instead
		let [, host, port] = server.match(/^([\d\w-.]+|\[[0-9a-fA-F:.]+\]|(?:[0-9a-fA-F]*:){2}[0-9a-fA-F:.]*$)(?::(\d+))?$/) || [];
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
	return null;
};

const sumBuffer = (buffer) => {
	// correct buffer byte index
	const data = Array.from(buffer).reverse();
	return data.reduce((pre, cur, index) => {
		// pre + cur * (2 ** 8 ** index)
		return pre + cur * Math.pow(1 << 8, index);
	}, 0);
};

const intToBuffer = (data, length) => {
	let hex = data.toString(16);
	// if the length of `hex` is odd, the last letter will be ignored like this:
	// 'b16212c' => Buffer.from('b16212', 'hex') /* ignores 'c' */ => [177, 98, 18]
	// so we should prefix it with padding zero like this:
	// '0b16212c' => Buffer.from('0b16212c', 'hex') => [11, 22, 33, 44]
	if (hex.length & 1) {
		hex = '0' + hex;
	}
	let buffer = Buffer.from(hex, 'hex');
	if (length) {
		if (length > buffer.length) {
			// fill high bits with zero
			return Buffer.concat([Buffer.alloc(length - buffer.length), buffer]);
		}
		else if (length < buffer.length) {
			// drop high bits
			return Buffer.slice(-length);
		}
	}
	return buffer;
};

const reverseFill = (data) => {
	const list = Object.keys(data);
	list.forEach(key => {
		data[data[key]] = key;
	});
	return data;
};

const isIPv6 = (ip) => {
	// an IPv6 address has at least two :
	return ip.indexOf(':') !== ip.lastIndexOf(':');
};

const trimIPv6Bracket = (ip) => {
	return ip.replace(/[[\]]/g, '');
};

const addIPv6Bracket = (ip) => {
	return `[${trimIPv6Bracket(ip)}]`;
};

const formatIP = (ip, compress = true) => {
	if (isIPv6(ip)) {
		ip = trimIPv6Bracket(ip).toLowerCase();
		if (ip.indexOf('.') >= 0) {
			// the IPv6 address has IPv4 part, e.g. abcd::1.2.3.4 == abcd::102:304
			// split v6 part and v4 part
			const [, v6, v4] = ip.match(/^([0-9a-f:]+):((?:[0-9]+\.){3}[0-9]+)$/);
			const [a, b, c, d] = v4.split('.');
			ip = [v6, (a << 8) + (+b), (c << 8) + (+d)].map(e => e.toString(16)).join(':');
		}
		// remove leading zero of each part
		ip = ip.replace(/(^|:)0*([0-9a-f]+)(?=$|:)/g, '$1$2');
		if (compress) {
			if (/(^|:)0(?=$|:)/.test(ip)) {
				// the IP can be compressed
				// decompress first, so that we can find the best part to shorten and standard the result
				return compressIPv6(decompressIPv6(ip));
			}
			// the IP cannot be compressed, or has already been compressed and no other part can be compressed
			return ip;
		}
		else {
			return decompressIPv6(ip);
		}
	}
	else {
		// remove IPv4 leading zero of each part
		return ip.replace(/(^|\.)0*(\d+)(?=$|\.)/g, '$1$2');
	}
};

const compressIPv6 = (ip) => {
	if (ip.indexOf('::') >= 0) {
		return ip;
	}
	// find the longest full-zero token and replace it to '::'
	const regexp = /(?:^|:)[0:]+:(?:0+$)?/g;
	const match = ip.match(regexp);
	if (match) {
		let longest = 0;
		let index = 0;
		match.forEach((e, i) => {
			if (e.length > longest) {
				longest = e.length;
				index = i;
			}
		});
		ip = ip.replace(regexp, pattern => {
			if (!index) {
				pattern = '::';
			}
			index--;
			return pattern;
		});
	}
	return ip;
};

const decompressIPv6 = (ip) => {
	if (ip.indexOf('::') < 0) {
		return ip;
	}
	const [leftPattern, rightPattern] = ip.split(/(?:^)?::(?:$)?/);
	const [leftTokens, rightTokens] = [leftPattern, rightPattern].map(e => (e || '0').split(':'));
	const [leftLen, rightLen] = [leftTokens, rightTokens].map(e => e.length);

	let tokens;
	// if leftLen is 8, then the IP is not compressed,
	// we can ignore the rightTokens created by ourselves
	if (leftLen === 8) {
		tokens = leftTokens;
	}
	else {
		// fill the shorten parts
		tokens = leftTokens.concat('0'.repeat(8 - leftLen - rightLen).split(''), rightTokens);
	}
	return tokens.join(':');
};

const isWildcardIP = (ip) => {
	if (isIPv6(ip)) {
		ip = trimIPv6Bracket(ip);
		return /^[0:]+$/.test(ip);
	}
	return /^(0+\.){3}0+$/.test(ip);
};

const getLocalIPs = (force) => {
	if (localIPs && localIPs.length && !force) {
		return localIPs;
	}
	const ifs = require('os').networkInterfaces();
	localIPs = [];
	Object.keys(ifs).forEach(ifname => {
		ifs[ifname].forEach(item => localIPs.push(item.address));
	});
	return localIPs;
};

const mapIPv4ToIPv6 = (ip) => {
	return formatIP('::ffff:' + ip);
};

const isLocalIP = (fn => {
	const ips = getLocalIPs();
	const patterns = [];
	ips.forEach(e => {
		if (isIPv6(e)) {
			patterns.push(formatIP(e));
		}
		else {
			patterns.push(formatIP(e).replace(/\./g, '\\.'), formatIP(mapIPv4ToIPv6(e)));
		}
	});
	// 127.0.0.0/8 are loopback IPs, but if we bind IP to 0.0.0.0 or [::],
	// only 127.0.0.1 and ::1 will accept the real request
	// to test loopback IP, use `isLookbackIP()`
	const regexp = RegExp(`^(?:${ patterns.join('|') })$`, 'i');
	return fn.bind(this, regexp);
})((pattern, ip) => {
	ip = formatIP(ip);
	return pattern.test(ip);
});

const isLookbackIP = (ip) => {
	if (isIPv6(ip)) {
		ip = trimIPv6Bracket(ip);
		// ::ffff:127.*.*.* | ::ffff:7f??:* | 0:0:0:0:0:ffff:127.*.*.* | 0:0:0:0:0:ffff:7f??:: | 0:0:0:0:0:ffff:7f??:*
		return /^0*:[0:*]:ffff:(?:127\.|7f[0-9a-fA-F]{2}:[0-9a-fA-F]{1,4}$)|(0+:){5}:ffff:(?:127\.|7f[0-9a-fA-F]{2})/i.test(ip);
	}
	return /^127/.test(ip);
};

const isSameIP = (a, b) => {
	[a, b] = [a, b].map(e => formatIP(e));
	return a === b || (!isIPv6(a) && mapIPv4ToIPv6(a) === b);
};

const bufferToIP = (buffer, compress = true) => {
	if (buffer.length === 4) { // IPv4
		return Array.from(buffer).join('.');
	}
	else { // IPv6
		let res = '';
		for (let i = 0, len = buffer.length; i < len; i += 2) {
			res += (i ? ':' : '') + ((buffer[i] << 8) + (buffer[i + 1])).toString(16);
		}
		if (compress) {
			res = compressIPv6(res);
		}
		return res;
	}
};

const ipToBuffer = (ip) => {
	if (isIPv6(ip)) {
		ip = decompressIPv6(ip);
		return Buffer.from(ip.split(':').map(e => ('0000' + e).substr(-4)).join(''), 'hex');
	}
	else {
		return Buffer.from(ip.split('.').map(e => +e));
	}
};

module.exports = {
	isIPv6,
	isWildcardIP,
	getLocalIPs,
	mapIPv4ToIPv6,
	isLocalIP,
	isLookbackIP,
	isSameIP,
	trimIPv6Bracket,
	addIPv6Bracket,
	parseServer,
	sumBuffer,
	intToBuffer,
	reverseFill,
	bufferToIP,
	ipToBuffer,
	formatIP,
	compressIPv6,
	decompressIPv6
};