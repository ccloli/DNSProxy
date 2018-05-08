const fs = require('fs');
const { parseServer } = require('./utils');

const defaultConfig = {
	settings: {
		tcp: false,
		udp: false,
		host: '::',
		port: 53,
		timeout: 5000
	},
	servers: {},
	rules: []
};

const loadConfig = (path) => {
	// require() cannot be reloaded until restart
	// const config = require(path);
	const config = JSON.parse(fs.readFileSync(path, 'utf8'));

	// only merge the first level and second level config
	const result = Object.assign({}, defaultConfig, config);
	Object.keys(defaultConfig).forEach(key => {
		if (typeof defaultConfig[key] !== 'object' || defaultConfig[key] instanceof Array) {
			return;
		}
		result[key] = Object.assign({}, defaultConfig[key], result[key]);
	});

	// parse servers
	const { servers, rules } = result;
	Object.keys(servers).forEach(key => {
		servers[key] = parseServer(servers[key]);
	});
	for (let rule of rules) {
		const { server } = rule;
		if (server) {
			if (typeof server === 'string' && servers[server]) {
				rule.server = servers[server];
			}
			else {
				rule.server = parseServer(server);
			}
		}
	}

	return result;
};

module.exports = loadConfig;