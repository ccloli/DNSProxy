const { isIPv6 } = require('../common/utils');
const { DNSTYPE } = require('../common/consts');

class hosts {
	constructor(config) {
		this.list = [];

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
	init({ file }) {
		if (!file) {
			throw new Error('Field \'file\' is required for list parser');
		}
		this.parse(file);
	}

	/**
	 * Parse input data, save parsed data to this.list
	 * 
	 * @private
	 * @param {string} data - the data needs to parse
	 * @memberof list
	 */
	parse(data) {
		const list = data.split(/\r?\n/);
		const result = [];
		list.forEach(elem => {
			try {
				// remove comments
				elem = elem.replace(/#.*/, '').trim();

				const [target, ...hostList] = elem.split(/\s+/) || [];

				// check if the rule is empty
				if (!target || !hostList.length) {
					return;
				}

				let type = 'A';
				if (isIPv6(target)) {
					type = 'AAAA';
				}

				hostList.forEach(host => {
					let exclude = false;

					// check if the rule is exclude rule
					if (host[0] === '-') {
						exclude = true;
						host = host.substr(1);
					}
					if (!host) {
						return;
					}

					let regexp;
					// check if the rule is an regular expression
					if (host[0] === '/') {
						regexp = this.parseRegExp(host);
					}
					else {
						regexp = this.parseWildcard(host);
					}

					// the latter one has a higher precedence
					result.unshift({
						data: target,
						type,
						regexp,
						exclude
					});
				});
			}
			catch (err) {
				console.log(`Fail to parse rule ${elem}`);
				console.log(err);
			}
		});
		this.list = result;
	}

	/**
	 * Test if domain matches one of the rules
	 * 
	 * @public 
	 * @param {string} host - the domain name needs to be checked
	 * @param {number} queryType - the query type to be checked
	 * @returns {object|null} if the domain name matches, return { resolve }, or return null
	 * @memberof list
	 */
	test(host, queryType) {
		// only resolve type is A or AAAA
		queryType = DNSTYPE[queryType];
		if (queryType !== 'A' && queryType !== 'AAAA') {
			return null;
		}
		for (let { regexp, exclude, type, data } of this.list) {
			if (regexp.test(host) && queryType === type) {
				return exclude ? null : {
					resolve: { type, data }
				};
			}
		}
		return null;
	}
}

module.exports = hosts;