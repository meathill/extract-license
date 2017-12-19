const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const {findKey, isArray, isPlainObject} = require('lodash');

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const writeFile = promisify(fs.writeFile);

async function extract(folder) {
  const modules = `${folder}/node_modules`;
  let mods = await readdir(modules, 'utf8');

  const stats = await Promise.all(mods.map(mod => {
    return mod !== '.' && mod !== '..' && mod !== '.bin' ? stat(`${modules}/${mod}`) : null;
  }));

  mods = mods.filter((mod, index) => {
    return stats[index] && stats[index].isDirectory();
  });

  mods = await Promise.all(mods.map(async mod => {
    let {license, LICENSE, licenses} = require(`${modules}/${mod}/package.json`);

    license = license || LICENSE || licenses;
    if (license) {
      if (isPlainObject(license)) {
        license = license.type;
      }
      if (isArray(license)) {
        if (license.length === 1) {
          license = license[0].type;
        } else {
          license = `(${license.map(item => item.type).join(' OR ')})`;
        }
      }

      return `* ${mod}: ${license}`;
    }

    // read from readme
    if (mod === 'options') {
      console.log('a');
    }
    let files = await readdir(`${modules}/${mod}`, 'utf8');
    let readme = files.find(file => {
      return /^readme/i.test(file);
    });
    if (readme) {
      let content = await readFile(`${modules}/${mod}/${readme}`, 'utf8');
      let matches = content.match(/#+ (?:licence|license) (\S*)/i);
      if (matches && matches[1]) {
        license = matches[1].replace(/^\(/, '');
        license = license.replace(/\)$/, '');
        license = license.replace(/#/g, '');
        if (license) {
          return `* ${mod}: ${license}`;
        }
      }

      let index = content.search(/#+ (?:licence|license)/i);
      if (index !== -1) {
        matches = content.substr(index).match(/mit|apache|gpl/i);
        if (matches) {
          return `* ${mod}: ${matches[0]}`;
        }
      }
    }

    // standalone License file, no keyword, hard to retrieve
    const known = {
      MIT: ['extsprintf', 'verror'],
      BSD: ['domelementtype', 'domhandler', 'domutils'],
    };
    license = findKey(known, repos => {
      return repos.indexOf(mod) !== -1;
    });
    if (license) {
      return `* ${mod}: ${license}`;
    }

    return `* ${mod}: UNKNOWN`;
  }))
    .catch(err => {
      console.warn(err);
    });

  await writeFile(`${folder}/licences.md`, mods.join('\n'), 'utf8');
}

let target = process.argv[2];

extract(path.resolve(process.cwd(), target))
  .then(() => {
    console.log('done');
  });