DNSProxy
===============

Proxy and forward your DNS request!

DNSProxy is a simple DNS proxy server, which helps you to forward DNS requests from clients to another DNS server.

***

## Features

- Bind proxy server with any IP or port
- Support TCP and UDP protocol
- Lookup upstream server with specific port and protocol (UDP, TCP)
- Both proxy server and upstream server support IPv4 and IPv6
- Wildcard rules and regular expression rules
- Custom parser to extend more rules!

## Use Cases

- Use TCP DNS on your operating system.
- Use public DNS server but forward Intranet domains to your company DNS server.
- Use DNS server provided by ISP for speed, and slower DNSCrypt server for poisoned domains.

## Install

### Requirement

This work is developed with Node.js v8.6.0, so it should work on Node.js v8+.

### Clone from GitHub

```sh
git clone https://github.com/ccloli/DNSProxy.git
cd DNSProxy
npm install -g
```

## Usage

```
  dnsproxy [options]

Options:
  -c, --config-file <path>      Specify the configuration file
                                (default: ./config.json)
```

You can also specify a system environment variable `DNSPROXY_CONFIG` so that you don't need to pass `-c` option every time.

If you don't pass the `-c` option, or don't set the environment variable, it'll try loading from `./config.json`.

Once it runs, you can press `Ctrl + R` to reload config, press `Ctrl + C` or `Ctrl + Z` to exit.

## Config

### Create a config file

The config file is a JSON file, it should follow the JSON structure.

To create a config file, you can use the sample file as template, then edit it as you like, then remove all the comments and save. 

```sh
cp config.sample.json config.json
```

### Default config

Your config will be merged with default config, if you don't specify some fields, they'll be overwritten by default config.

```json
{
    "tcp": {                    // TCP proxy server config
        "enable": false,        // enable TCP server
        "host": "::",           // bind IP address, use IPv6 all-zero address ([::])
                                // will also accept requests to IPv4 0.0.0.0
        "port": 53              // TCP server listen port
    },
    "udp": {                    // UDP proxy server config
        "enable": false,        // enable UDP server
        "host": "::",           // bind IP address
        "port": 53              // UDP server listen port
    },
    "servers": {                // name server list
        "default": {            // a `default` server is required
            "host": "8.8.8.8",  // see `Name server config` section for details
            "port": 53,
            "type": "udp"
        }
    },
    "rules": []                 // proxy rules, see `Rule config` section
}
```

### Name server config

You can config some common name servers at `servers` field. Give it a name, fill its attribute, then reference it in `rules`.

You should specify a `default` server, so that if a domain doesn't match any rule, it'll be looked up from the `default` server.

The name server config accepts the following formats:

```json
// a common plain object, specify all the needed fields
{ "host": "127.0.0.1", "port": 53, "type": "udp" }

// another common object, but use a IPv6 host
{ "host": "[::1]", "port": 5353, "type": "tcp" }

// combine host and port to `host`
{ "host": "[::1]:5353", "type": "tcp" }

// ignore port and type, will use port `53` and `udp` protocol by default
// the following object will be the same as the first one
{ "host": "127.0.0.1", "port": 53 }
{ "host": "127.0.0.1", "type": "udp" }
{ "host": "127.0.0.1" }

// or just a string, syntax is `<host>[:<port=53>][@<type=udp>]`
"127.0.0.1:53@udp"
"[::1]:5353@tcp"
"127.0.0.1:53"
"127.0.0.1@udp"
"127.0.0.1"
```

### Rule config

You can set some rules to match the lookup name, the matched name will be looked up by the specific name server in the rule. The prior of rules is by the order you set, and who are at the first of the list, who will be tested first. If no rule match the name, it'll fallback to use the `default` name server.

A common rule config should use the following format, but should notice that if you're using some extend rules written by community, you should use that specific format if it has.

```json
{
    "file": "<file-path>",     // rule file 
    "type": "<rule-type>",     // rule type, see `Rule Parser` section for more info
    "server": "<name-server>"  // lookup server, can use the name sets in `servers`
}
```

To make it clear, suppose you define 2 name servers in `servers`, named `default` and `google`. And you have 2 `list` type rules, one will use the `google` name server, and another one will use a server not defined in `servers`, you can set your config file like this.

```json
{
    "tcp": { ... },
    "udp": { ... },
    "servers": {
        "default": { "host": "1.1.1.1", "port": "53", "type": "udp" },
        "google":  { "host": "8.8.8.8", "port": "53", "type": "udp" }
    },
    "rules": [{
        "file": "rules/one.txt",
        "type": "list",
        "server": "google"
    }, {
        "file": "rules/another.txt",
        "type": "list",
        "server": { "host": "1.2.4.8", "port": "53", "type": "udp" }
    }]
}
```

Then here comes a domain name. If the domain matches `one.txt`, it will lookup `8.8.8.8`, or if it matches `another.txt` will lookup `1.2.4.8`, or it will lookup `1.1.1.1`.

## Rule Parser

Here is the offical supported rule parsers. They should fit most of common use cases, but if you want to create a custom rule, see [Create custom parser](#create-custom-parser) section for details.

### `list`

List type is the basic type of DNSProxy rule parser. 

A `list` rule file is a list of domain. If a domain is in the list, then it'll match the rule. To make it easier to use, you can even use wildcard letters or regular expression to match multiple domains.

-   Wildcard  
    You can use wildcard character for multiple cases, available characters are below.  
    + `*` - case zero, one or more than one letters  
    + `?` - case one letter  
    + start with `.` - case naked domain and all subdomains  
-   RegExp  
    You can use JavaScript-style regular expression to match, just quote it with a slash `/` like `/.*/`. But make sure it can be parsed by JavaScript and fit your Node.js environment, like lookbehind assertions (`(?<=)` in C#) cannot be accepted in most Node.js version, as it's added in ECMAScript 2018, so most of JavaScript environment don't support it.

You should put your match rules in each line (split them with a "enter"). Here is an example of rule file, and the comments note how the match rules will work.

```
# rule.txt
abc.com           # only match `abc.com` but won't match `sub.abc.com`
*.def.com         # will match `sub.def.com` but won't match `def.com`
.ghi.com          # will match both `ghi.com` and `sub.ghi.com`
jkl.*             # will match `jkl.com`, `jkl.net`, `jkl.co.jp`
*n?.com           # will match `mno.com`, `longnp.com`, `np.com`, but
                  # won't match `mnop.com`, `mn.com`, `n.com`
/^pqr[0-9]*\./    # regex, will match `pqr.com`, `pqr123.com`, but
                  # won't match `pqrst.com`, `sub.pqr.com`
```

## Extend

### Create custom parser

You can create your custom parser to add support of any type rule file.

To create a custom parser, you only need to write a constructor function, that its instances have a `parse()` method to parse rule file and a `test()` method to detect if the domain follow the rules.

You can check `parsers/` folder to get some examples and ideas. Here is an template that uses ES6 class to create a custom type `example`:

```js
/**
 * Rule type: example
 * 
 * @class example
 */
class example {
    constructor(rules) {
        this.parsedRules = [];
        if (rules) {
            this.parse(rules);
        }
    }

    /**
     * Parse input data, save parsed data to this.parsedRules
     * 
     * @public 
     * @param {string} rules - the rules needs to parse
     * @memberof example
     */
    parse(rules) {
        this.parsedRules = doSomething(rules);
    }

    /**
     * Test if the domain matches one of the rules
     * 
     * @public 
     * @param {string} host - the domain name needs to be checked
     * @returns {boolean} the host matches the rules or not
     * @memberof example
     */
    test(host) {
        if (hostMatchRule(host, this.parsedRules)) {
            return true;
        }
        return false;
    }
}
```

You can also use ES5- prototype to write your code:

```js
function example(rules) {
    // TODO
}
example.prototype = {
    parse: function(rules) {
        // TODO
    },
    test: function(host) {
        //TODO
    }
};
```

After you finish the work, put the file to somewhere safe. Then add an array field `extend-parsers` to your config file if it doesn't have, and put the file path in it like this, save and reload to have a test!

```json
{
    ...
    "extend-parsers": [
        "path/to/parser/example.js"
    ],
    "rules": [
        { "file": "path/to/rule.txt", "type": "example", "server": { ... } }
    ]
}
```

## License

GPLv3