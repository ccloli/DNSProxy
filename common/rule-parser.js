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

				cur.fieldType = cur.fieldType || {
					file: 'file',
					server: 'server'
				};
				cur.fields = {
					file: [],
					server: []
				};
				for (let i in cur.fieldType) {
					const key = cur.fieldType[i];
					if (!cur.fields[key]) {
						console.log(`Field type of '${i}' in parser ${cur.name} is '${key}', which is invalid`);
						continue;
					}
					cur.fields[key].push(i);
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

	loadServerField(server, servers) {
		if (typeof server === 'string') {
			if (servers[server]) {
				return servers[server];
			}
			// *.*.*.* | [(*:){2,7}*] | [(*:){2,6}*.*.*.*] | *:* | (*:){2,7}* | (*:){2,6}*.*.*.* | *@*
			else if (/^(?:(?:[\d\w-.]+\.[\d\w-]+|\[(?:[0-9a-fA-F]*:){2,7}[0-9a-fA-F]*\]|\[(?:[0-9a-fA-F]*:){2,6}(?:\d+\.){3}\d+)(?::\d+)?|(?:[0-9a-fA-F]*:){2,7}[0-9a-fA-F]*|\[(?:[0-9a-fA-F]*:){2,6}(?:\d+\.){3}\d+)(?:@\w+)?$/.test(server)) {
				return parseServer(server);
			}
			else {
				console.log(`Server '${server}' is not found in server list, use the default server`);
				return this.defaultServer;
			}
		}
		else {
			return parseServer(server);
		}
	}

	loadFileField(file, dir) {
		if (!file) return null;
		const exactFile = path.resolve(path.dirname(dir), file);
		try {
			return fs.readFileSync(exactFile, 'utf8');
		}
		catch(err) {
			console.log(`Fail to load file '${file}'`);
			throw err;
		}
	}

	initRules(rules = [], servers, configPath) {
		this.inputRules = rules;

		// TODO: use asynchronous way to parse
		// Promise.all(rules.map((elem, index) => {
		this.rules = rules.map((elem, index) => {
			try {
				let { type } = elem;
				let item = Object.assign({}, elem);

				const Parser = this.parser[type];
				if (!Parser) {
					throw new ReferenceError(`Parser '${type}' is not defined`);
				}

				const { file, server } = Parser.fields;
				file.forEach(e => item[e] = this.loadFileField(item[e], configPath));
				server.forEach(e => item[e] = this.loadServerField(item[e], servers));

				const parser = new Parser();
				parser.init(item);

				return Object.assign(item, {
					index,
					parser,
					raw: elem
				});
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
			const { index, parser } = rule;
			const result = parser.test(domain);
			if (result) {
				return Object.assign({ index }, result);
			}
		}
		return this.defaultServer ? {
			index: -1,
			server: this.defaultServer
		} : null;
	}
}

module.exports = RuleParser;