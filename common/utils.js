let localIPs = null;

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
	const [a, b, c, d] = ip.split('.');
	return [
		'::ffff:' + ip,
		'::ffff:' + [a << 8 + b << 0, c << 8 + d << 0].map(e => e.toString(16)).join(':')
	];
};

const getSameIPPattern = (ip, v4tov6 = true) => {
	if (isIPv6(ip)) {
		ip = trimIPv6Bracket(ip);
		if (ip.indexOf('.') >= 0) {
			const [v6, v4] = ip.match(/^([0-9a-fA-F:]+):((?:[0-9]+\.){3}[0-9]+)$/);
			return getSameIPPattern(v6) + ':' + getSameIPPattern(v4, false);
		}
		return '0*' + ip.replace(/(?:^0+|:0*)+:/g, ':[0:]*:').replace(/(?:^|:)0*([0-9a-fA-F])(:|$)/g, ':0*$1$2').replace(/:$/, ':0*');
	}
	const v4Pattern = ip.replace(/\\./g, '\\.').replace(/(^|\.)0*(\d+)/g, '$10*$2');
	if (!v4tov6) {
		const v6Pattern = mapIPv4ToIPv6(ip).map(e => getSameIPPattern(e));
		return [v4Pattern, ...v6Pattern].concat('|');
	}
	return v4Pattern;
};

const isLocalIP = (fn => {
	const ips = getLocalIPs();
	const patterns = ips.map(e => getSameIPPattern(e));
	// 127.0.0.0/8 are loopback IPs, but if we bind IP to 0.0.0.0 or [::],
	// only 127.0.0.1 and ::1 will accept the real request
	// to test loopback IP, use `isLookbackIP()`
	const regexp = RegExp(`^(?:${ patterns.join('|') })$`, 'i');
	return fn.bind(this, regexp);
})((pattern, ip) => {
	ip = trimIPv6Bracket(ip);
	return pattern.test(ip);
});

const isLookbackIP = (ip) => {
	if (isIPv6(ip)) {
		ip = trimIPv6Bracket(ip);
		// ::ffff:127.*.*.* | ::ffff:7f??:* | 0:0:0:0:0:ffff:127.*.*.* | 0:0:0:0:0:ffff:7f??:: | 0:0:0:0:0:ffff:7f??:*
		return /^0*:[0:*]:ffff:(?:127(\.)|7f[0-9a-fA-F]{2}:[0-9a-fA-F]{1,4}$)|(0+:){5}:ffff:(?:127\.|7f[0-9a-fA-F]{2})/i.test(ip);
	}
	return /^127/.test(ip);
};

const isSameIP = (a, b) => {
	if (!isIPv6(b)) {
		// force replace `b` to IPv6, as pattern of `a` supports both v4 and v6
		b = mapIPv4ToIPv6(b)[0];
	}
	return RegExp(getSameIPPattern(a)).test(b);
};

const bufferToIP = (buffer, compress = true) => {
	if (buffer.length === 4) {
		return Array.from(buffer).join('.');
	}
	else {
		let res = '';
		for (let i = 0, len = buffer.length; i < len; i += 2) {
			res += (i ? ':' : '') + ((buffer[i] << 8) + (buffer[i + 1])).toString(16);
		}
		if (compress) {
			// find the longest full-zero token and replace it to '::'
			const regexp = /(?:^|:)[0:]+:(?:0+$)?/g;
			const match = res.match(regexp);
			if (match) {
				let longest = 0;
				let index = 0;
				match.forEach((e, i) => {
					if (e.length > longest) {
						longest = e.length;
						index = i;
					}
				});
				res = res.replace(regexp, pattern => {
					if (!index) {
						pattern = '::';
					}
					index--;
					return pattern;
				});
			}
			return res;
		}
		return res;
	}
};

const ipToBuffer = (ip) => {
	if (isIPv6(ip)) {
		const [leftPattern, rightPattern] = ip.split(/(?:^)?::(?:$)?/);
		const leftTokens = (leftPattern || '0').split(':');
		const rightTokens = (rightPattern || '0').split(':');
		const leftLen = leftTokens.length;
		const rightLen = rightTokens.length;

		let tokens;
		// if leftLen is 8, then the IP is not compressed,
		// we can ignore the rightTokens created by ourselves
		if (leftLen === 8) {
			tokens = leftTokens;
		}
		else {
			tokens = leftTokens.concat('0'.repeat(8 - leftLen - rightLen).split(''), rightTokens);
		}

		return Buffer.from(tokens.map(e => ('0000' + e).substr(-4)).join(''), 'hex');
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
	getSameIPPattern,
	isLocalIP,
	isLookbackIP,
	isSameIP,
	trimIPv6Bracket,
	addIPv6Bracket,
	parseServer,
	sumBuffer,
	reverseFill,
	bufferToIP,
	ipToBuffer
};