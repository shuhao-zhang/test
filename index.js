const fs = require('fs');
const readline = require('readline');
const path = require('path');
const Typo = require('typo-js');
const sleep = require('sleep');
const recursive = require('recursive-readdir');
const each = require('async-each');

const dictionary = new Typo('en_US');
const appDir = path.dirname(require.main.filename);

const langOptions = {
                 'rb': '#',
                 'js': '//',
                 'java': '//',
                 'py': '#',
                 'go': '//'
               };
const ws = fs.createWriteStream('./report.txt');
const ignoreSet = new Set(['js', 'JavaScript', 'JS']);

function containComment(str, langType) {
    const commentSymbol = langOptions[langType];
    if (!commentSymbol) {
        return -1;
    }
    if (str) {
        var startingIndex = str.indexOf(commentSymbol);
        return startingIndex === -1 ? -1 : startingIndex + commentSymbol.length;
    }
    return -1;
}

function isAlpha(ch) {
    return ch.match(/^[a-z]+$/i) !== null;
}

function isIgnored(ch) {
    return ignoreSet.has(ch);
}

function spellCheck(str, startIndex) {
    var checkStr = str.substring(startIndex);

    var words = checkStr.replace(/[\-\,\.\(\)\*\[\]]/g, ' ').split(/ +/);
    // console.log(words);
    var replaceDict = {};
    words.map(word => {
        if (!isAlpha(word)) {
            return;
        }
        if (isIgnored(word)) {
            return;
        }
        var suggestions = dictionary.suggest(word);
        if (suggestions.length > 0) {
            replaceDict[word] = suggestions;
        }
    });
    return replaceDict;
} 

function spellCheck2(str, startIndex) {
    var checkStr = str.substring(startIndex);

    var words = checkStr.replace(/[\-\,\.\(\)\*\[\]]/g, ' ').split(/ +/);
    // console.log(words);
    var replaceDict = '';
    words.map(word => {
        if(!isAlpha(word)) {
            return;
        } 
        if (isIgnored(word)) {
            return;
        }
        if(!dictionary.check(word)) {
            replaceDict += word + ' ';
        }
    });
    return replaceDict;
}
function convertToString(obj) {
    if(typeof obj === 'string') {
        return obj;
    }
    var str = '';
    Object.keys(obj).forEach(function(key) {
        var values = obj[key].join(' ');
        str += String(key) + ' ' + values + '\n';
    });
    return str;
}

function testPrinting(pathToFile) {
    var instream = fs.createReadStream(pathToFile);
    
    var rl = readline.createInterface({
        input: instream,
        output: ws,
        terminal: false
    });

    var counter = 0;
    var reportObject = {};
    var written = false;
    rl.on('line', function(line) {
        counter++;
        var startIndex = containComment(line, 'js');
        if (startIndex >= 0) {
            var result = spellCheck2(line, startIndex);
            var str = convertToString(result);
            /*
            if(str) {
                var title = String(counter);
                if(!written) {
                    title = pathToFile + ' ' + title; 
                    written = true;
                }
                ws.write(title + '\n'+str);
            }
            */
            if(str) {
                ws.write(pathToFile + ' ' + counter + '\n' + str + '\n');
            }
        }
    });
}

//testPrinting('./examples/test.go');
function testDir(pathToDir) {
    recursive(pathToDir, function(err, filenames) {
        if (err) {
            console.log(err);
            return;
        }
        each(filenames, testPrinting, function(error, contents) {
            if (error) {
                console.log(error);
            }
        });
        /*
        filenames.map(name => {
            testPrinting(name);
        });
        */
    });
}

testDir('examples/');
