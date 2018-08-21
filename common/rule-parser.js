const fs = require('fs');
const path = require('path');
const { parseServer } = require('./utils');
const dir = path.resolve(__dirname, '../parsers/');

class RuleParser {
	constructor() {
		this.defaultServer = null;
		this.parser = {};
		this.rules = [];
	}

	initDefaultServer(server) {
		this.defaultServer = server;
	}

	initParsers(extendPath = [], configPath) {
		const parser = {};

		let defaultPath = fs.readdirSync(dir).filter(e => /\.js$/.test(e));
		defaultPath = defaultPath.map(e => ({
			type: 'file',
			path: path.resolve(dir, e)
		}));
		extendPath = extendPath.map(e => {
			let [ file, name ] = e.trim().split(/\s*\|\s*/) || [];
			let type = 'file';
			const item = file.split(/\s*:\s*/);
			if (item.length > 1) {
				[type, file ] = item;
			}
			return { type, name, path: path.resolve(path.dirname(configPath), file) };
		});

		[...defaultPath, ...extendPath].forEach(({ type, path, name }) => {
			try {
				const cur = require(path);
				name = name || cur.name;
				if (!name && type !== 'npm') {
					throw new SyntaxError(`Parser file '${path}' does't specify its name`);
				}
				if (!cur.prototype.parse || !cur.prototype.test) {
					throw new SyntaxError(`Parser ${cur.name} doesn't provide parse() or test() method`);
				}

				if (name) {
					parser[name] = cur;
				}
				if (type === 'npm') {
					parser[`npm:${path}`] = cur;
				}
			}
			catch (err) {
				console.log(`Fail to import parser file '${path}'`);
				console.log(err);
			}
		});

		this.parser = parser;
	}

	initRules(rules = [], servers, configPath) {
		this.inputRules = rules;

		// TODO: use asynchronous way to parse
		// Promise.all(rules.map((elem, index) => {
		this.rules = rules.map((elem, index) => {
			let { type, file, server } = elem;
			
			if (server) {
				if (typeof server === 'string') {
					if (servers[server]) {
						server = servers[server];
					}
					// *.*.*.* | [(*:){2,7}*] | [(*:){2,6}*.*.*.*] | *:* | (*:){2,7}* | (*:){2,6}*.*.*.* | *@*
					else if (/^(?:(?:(?:\d+\.){3}\d+|\[(?:[0-9a-fA-F]*:){2,7}[0-9a-fA-F]*\]|\[(?:[0-9a-fA-F]*:){2,6}(?:\d+\.){3}\d+)(?::\d+)?|(?:[0-9a-fA-F]*:){2,7}[0-9a-fA-F]*|\[(?:[0-9a-fA-F]*:){2,6}(?:\d+\.){3}\d+)(?:@\w+)?$/.test(server)) {
						server = parseServer(server);
					}
					else {
						console.log(`Server '${server}' is not found in server list, use the default server`);
						server = this.defaultServer;
					}
				}
				else {
					server = parseServer(server);
				}
			}

			try {
				const Parser = this.parser[type];
				if (!Parser) {
					throw new ReferenceError(`Parser '${type}' is not defined`);
				}

				const exactFile = path.resolve(path.dirname(configPath), file);

				try {
					const data = fs.readFileSync(exactFile, 'utf8');

					const parser = new Parser();
					parser.parse(data);

					return {
						file,
						exactFile,
						index,
						server,
						parser
					};
				}
				catch (err) {
					console.log(`Parser '${type}' cannot resolve file '${file}'`);
					console.log(err);
					return;
				}
			}
			catch (err) {
				console.log(`Rule #${index} cannot be parsed`);
				console.log(err);
			}
		}).filter(e => e);
	}

	resolve(domain) {
		domain = domain.toLowerCase();
		const len = domain.length;
		// remove the last dot, but keep the dot if querying root server
		if (domain[len - 1] === '.' && len > 1) {
			domain = domain.substr(0, len - 1);
		}
		for (let rule of this.rules) {
			const { file, index, server, parser } = rule;
			if (parser.test(domain)) {
				return {
					file,
					index,
					server
				};
			}
		}
		return this.defaultServer ? {
			file: null,
			index: -1,
			server: this.defaultServer
		} : null;
	}
}

module.exports = RuleParser;