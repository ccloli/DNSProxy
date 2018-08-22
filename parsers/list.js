/**
 * Rule type: list
 * 
 * @class list
 */
class list {
	constructor(config) {
		this.pattern = [];
		this.server = null;

		if (config) {
			this.init(config);
		}
	}

	/**
	 * Parse wildcard rule to regex
	 * 
	 * @private 
	 * @param {string} str - rule
	 * @returns {RegExp} parsed regex
	 * @memberof list
	 */
	parseWildcard(str) {
		const charMap = {
			'.': '\\.',
			'*': '.*',
			'?': '.'
		};
		let res = str.replace(/[.*?]/g, c => charMap[c]);
		// if first character is dot, then treat it as `*.` or `@.`(null)
		// e.g. `.example.com` will be `*.example.com` and `example.com`
		res = res.replace(/^\\\./, '(.*\\.)?');
		return new RegExp(`^${res}$`);
	}

	/**
	 * Parse regex rule to regex
	 * 
	 * @private 
	 * @param {string} str - rule
	 * @returns {RegExp} parsed regex
	 * @memberof list
	 */
	parseRegExp(str) {
		const pattern = str.match(/^\/(.+)\/([a-zA-Z]*?)$/);
		if (pattern) {
			return new RegExp(pattern[1], pattern[2] || undefined);
		}
		else {
			return new RegExp(str);
		}
	}

	/**
	 * Init parser
	 * 
	 * Check if the file is exist, if not exist, throw an error,
	 * else, save server and call this.parse() to parse file
	 * 
	 * @param {object} config - the config object needed to init
	 * @param {string} config.file - the rules to be parsed
	 * @param {object} config.server - the server to return if a domain matches
	 * @memberof list
	 */
	init({ file, server }) {
		if (!file) {
			throw new Error('Field \'file\' is required for list parser');
		}
		if (!server) {
			throw new Error('Field \'server\' is required for list parser');
		}
		this.server = server;
		this.parse(file);
	}

	/**
	 * Parse input data, save parsed patterns to this.patterns
	 * 
	 * @private
	 * @param {string} data - the data needs to parse
	 * @memberof list
	 */
	parse(data) {
		const list = data.split(/\r?\n/);
		const pattern = [];
		list.forEach(elem => {
			try {
				let exclude = false;
				// remove comments
				elem = elem.replace(/#.*/, '').trim();

				// check if the rule is exclude rule
				if (elem[0] === '-') {
					exclude = true;
					elem = elem.substr(1);
				}
				// check if the rule is empty
				if (!elem) {
					return;
				}

				let regexp;
				// check if the rule is an regular expression
				if (elem[0] === '/') {
					regexp = this.parseRegExp(elem);
				}
				else {
					regexp = this.parseWildcard(elem);
				}

				// the latter one has a higher precedence
				pattern.unshift({
					regexp,
					exclude
				});
			}
			catch(err) {
				console.log(`Fail to parse rule ${elem}`);
				console.log(err);
			}
		});
		this.pattern = pattern;
	}

	/**
	 * Test if domain matches one of the rules
	 * 
	 * @public 
	 * @param {string} host - the domain name needs to be checked
	 * @returns {object|null} if the domain name matches, return { server }, or return null
	 * @memberof list
	 */
	test(host) {
		for (let { regexp, exclude } of this.pattern) {
			if (regexp.test(host)) {
				return exclude ? null : {
					server: this.server
				};
			}
		}
		return null;
	}
}

module.exports = list;