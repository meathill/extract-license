const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const Handlebars = require('handlebars');
const {keys, isArray, isPlainObject} = require('lodash');

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const writeFile = promisify(fs.writeFile);
const licenseTemplates = {};

async function extract(folder) {
  let {dependencies} = require(`${folder}/package.json`);
  dependencies = keys(dependencies);
  dependencies = dependencies.reduce((memo, dependency) => {
    let {dependencies} = require(`${folder}/node_modules/${dependency}/package.json`);
    return memo.concat(keys(dependencies));
  }, dependencies);

  const modules = `${folder}/node_modules`;
  let mods = await readdir(modules, 'utf8');

  const stats = await Promise.all(mods.map(mod => {
    return dependencies.indexOf(mod) !== -1 ? stat(`${modules}/${mod}`) : null;
  }));

  mods = mods.filter((mod, index) => {
    return stats[index] && stats[index].isDirectory();
  });

  console.log('Number of dependencies: ' + mods.length);

  mods = await Promise.all(mods.map(async mod => {
    // read LICENSE file first
    let files = await readdir(`${modules}/${mod}`, 'utf8');
    let license = files.find(file => /^(license|licence)\b/i.test(file));
    if (license) {
      license = await readFile(`${modules}/${mod}/${license}`, 'utf8');
      return {
        mod,
        license,
      };
    }

    // no LICENSE file, find license and give it from template
    license = await findLicense(modules, mod, files);
    if (license) {
      license = await getLicense(license);
      return {
        mod,
        license,
      };
    }

    return {
      mod,
      license: 'UNKNOWN',
    };
  }))
    .catch(err => {
      console.warn(err);
    });

  return {
    folder,
    mods
  };
}

async function findLicense(modules, mod, files) {
  let {license, LICENSE, licenses} = require(`${modules}/${mod}/package.json`);

  license = license || LICENSE || licenses;
  if (license) {
    if (isPlainObject(license)) {
      license = license.type;
    } else if (isArray(license)) {
      if (license.length === 1) {
        license = license[0].type;
      } else {
        license = license.map(item => item.type);
      }
    }

    return license;
  }

  // read from readme
  let readme = files.find(file => {
    return /^readme\b/i.test(file);
  });
  if (readme) {
    let content = await readFile(`${modules}/${mod}/${readme}`, 'utf8');
    let matches = content.match(/#+ (?:licence|license) (\S*)/i);
    if (matches && matches[1]) {
      license = matches[1].replace(/^\(/, '');
      license = license.replace(/\)$/, '');
      license = license.replace(/#/g, '');
      if (license) {
        return license;
      }
    }

    let index = content.search(/#+ (?:licence|license)/i);
    if (index !== -1) {
      matches = content.substr(index).match(/mit|apache|gpl/i);
      if (matches) {
        return matches[0];
      }
    }
  }
}

async function getLicense(license) {
  if (!isArray(license)) {
    if (!license.replace) {
      console.log('a');
    }
    license = license.replace(/^\(/, '')
      .replace(/\)$/, '')
      .replace(/#/g, '')
      .split(/\s*AND\s*/g);
  }
  return Promise.all(license.map(async item => {
    let key = item.toLowerCase();
    if (key === 'public domain') {
      return item;
    }
    if (/\bx11\b/.test(key)) {
      key = 'mit';
    }
    if (!licenseTemplates[key]) {
      licenseTemplates[key] = await readFile(path.resolve(__dirname, `licenses/${key}`));
    }
    return licenseTemplates[key];
  }));

}

async function output({folder, mods}) {
  let template = await readFile(path.resolve(__dirname, 'template.hbs'), 'utf8');
  template = Handlebars.compile(template);
  let html = template({
    mods
  });
  let to = `${folder}/licences.md`;
  return Promise.all([folder, writeFile(to, html, 'utf8')]);
}

let target = process.argv[2];

extract(path.resolve(process.cwd(), target))
  .then(result => {
    return output(result);
  })
  .then(() => {
    console.log('done');
  })
  .catch(err => {
    console.log(err);
  });