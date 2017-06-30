#!/usr/bin/env node

/*!
 * @license MIT
 * Copyright (c) 2017 Bernhard Grünewaldt - codeclou.io
 * https://github.com/cloukit/legal
 */
const shell = require('shelljs');
const chalk = require('chalk');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const Gaze = require('gaze').Gaze;
const argv = require('yargs').argv
const NGC_BINARY='../library-build-chain/node_modules/.bin/ngc';
const ROLLUP_BINARY='../library-build-chain/node_modules/.bin/rollup';
const tsconfigTemplate = require('./build-tsconfig-template.js');
const packageJsonTemplate = require('./build-package-json-template.js');
const currentDir = shell.pwd().stdout;
const relativePath = (_path) => {
  return path.resolve(currentDir, _path);
}

/**
 * Build the package to dist
 * @param languageTarget {string} either 'es5' or 'es2015'
 * @param watch {boolean}
 */
const buildPackage = (languageTarget, watch) => {
  //
  // CLEANUP COPY SRC CONTENTS TO BUILD
  //
  if (shell.test('-d', relativePath('../build/src'))) shell.rm('-rf', relativePath('../build/src'));
  if (shell.test('-f', relativePath('../build/package-lock.json'))) shell.rm('-rf', relativePath('../build/package-lock.json'));
  if (!shell.test('-d', relativePath('../build/'))) shell.mkdir(relativePath('../build/'));
  shell.cp('-R', relativePath('../src'), relativePath('../build'));
  shell.cp('-R', relativePath('../manifest.json'), relativePath('../build'));

  //
  // CD BUILD DIR
  //
  shell.cd(relativePath('../build/'));
  const manifest = JSON.parse(shell.cat(relativePath('../build/manifest.json')));

  //
  // GENERATE TEMPORARY LIBRARY package.json TO INSTALL PEER DEPENDENCIES DURING BUILD
  //
  if (!watch && languageTarget === 'es5') {
    let packageJson = packageJsonTemplate.generate(manifest.moduleId, manifest.version, manifest.description, 'devDependencies', Object.assign({}, manifest.peerDependencies, manifest.devDependencies), 'dependencies', manifest.dependencies, 'peerDependencies', {});
    fs.writeFileSync(relativePath(`../build/package.json`), JSON.stringify(packageJson, null, 2));
    shell.echo(chalk.blue('>> =============='));
    shell.echo(chalk.blue('>> NPM INSTALL'));
    shell.echo(chalk.blue('>> =============='));
    const npmInstallResult = shell.exec('npm install');
    if (npmInstallResult.code !== 0) {
        shell.echo(chalk.red("NPM ERROR. STOP!"));
        return;
    }
  }

  //
  // BUILD OR WATCH
  //
  shell.echo(chalk.blue('>> =============='));
  shell.echo(chalk.blue(`>> ${watch ? 'WATCH' : 'BUILD'} : ${languageTarget}`));
  shell.echo(chalk.blue('>> =============='));


  //
  // WRITE TSCONFIGS
  //
  const tsConfig = tsconfigTemplate.generate(languageTarget, manifest.moduleId);
  fs.writeFileSync(relativePath(`../build/tsconfig-${languageTarget}.json`), JSON.stringify(tsConfig, null, 2));

  //
  // BUILD WITH ANGULAR COMPILER
  //
  const buildResult = shell.exec(`${NGC_BINARY} -p tsconfig-${languageTarget}.json`);
  if (buildResult.code !== 0) {
      shell.echo(chalk.red("NGC ERROR. STOP!"));
      return;
  }

  //
  // BUILD FLAT ONE FILE MODULE WITH ROLLUP
  //
  const rollupResult = shell.exec(`${ROLLUP_BINARY} _${languageTarget}/src/${manifest.moduleId}.js -o ../dist/${manifest.moduleId}.${languageTarget}.js`);
  if (rollupResult.code !== 0) {
      shell.echo(chalk.red("ROLLUP ERROR. STOP!"));
      return;
  }

  // ====================
  // DO ONLY ONCE FROM HERE
  if (languageTarget === 'es5') return;
  // ====================

  //
  // WRITE FINAL LIB package.json
  //
  packageJson = packageJsonTemplate.generate(manifest.moduleId, manifest.version, manifest.description, 'peerDependencies', manifest.peerDependencies, 'dependencies', manifest.dependencies, 'devDependencies', manifest.devDependencies);
  fs.writeFileSync(relativePath('../dist/package.json'), JSON.stringify(packageJson, null, 2));

  //
  // COPY METADATA FILE FOR TREE SHAKING
  //
  shell.cp(`_es2015/src/${manifest.moduleId}.metadata.json`, `../dist/${manifest.moduleId}.metadata.json`);

  //
  // COPY README
  //
  shell.cp(`../README.md`, `../dist/`);

  //
  // FIXME: SINCE WE CANNOT CREATE A TYPE-DEFINITION-BUNDLE FILE (YET) WE NEED TO COPY ALL *.d.ts FILES MANUALLY TO DIST
  //
  shell.echo(chalk.blue('>> =============='));
  shell.echo(chalk.blue(`>> D.TS FILES`));
  shell.echo(chalk.blue('>> =============='));
  fse.copySync(relativePath('../build/_es2015/src'), relativePath('../dist'), {
    filter: file => /^.*[.]ts$/.test(file) || shell.test('-d', file) // *.d.ts files and folders!
  });

  //
  // COMPODOC
  //

  // PATCH CDN URLS
  if (shell.test('-d', relativePath('../documentation'))) shell.rm('-rf', relativePath('../documentation/'));
  shell.cd(relativePath('../build'));
  const cdnUrl = 'https://cloukit.github.io/compodoc-theme/theme/1.0.0-beta.10';
  const templateFiles = [ 'page.hbs', 'partials/component.hbs', 'partials/module.hbs', 'partials/routes.hbs', 'partials/overview.hbs' ];
  for (let i=0; i<file.templateFiles.length; i++) {
    shell.exec(`sed -i -e 's@src="[^"]*js/@src="${cdnUrl}/dist/js/@g' ../library-build-chain/node_modules/compodoc/src/templates/${templateFiles[i]}`);
  }
  shell.exec(`sed -i -e 's@href="[^"]*styles/@href="${cdnUrl}/dist/css/@g' ../library-build-chain/node_modules/compodoc/src/templates/page.hbs`);
  shell.exec(`sed -i -e 's@href="[^"]*images/favicon.ico@href="${cdnUrl}/images/favicon.ico@g' ../library-build-chain/node_modules/compodoc/src/templates/page.hbs`);

  // EXECUTE COMPODOC
  if (!argv.watch) {
    shell.cd(relativePath('../'));
    const compodocResult = shell.exec(`../library-build-chain/node_modules/compodoc/bin/index-cli.js --tsconfig tsconfig-es5.json --hideGenerator --disablePrivateOrInternalSupport --name "${packageJson.name} v${packageJson.version}" src`);
    if (compodocResult.code !== 0) {
        shell.echo(chalk.red("COMPODOC ERROR. STOP!"));
        return;
    }
    if (shell.test('-d', relativePath('../documentation/fonts/'))) shell.rm('-rf', relativePath('../documentation/fonts/'));
    if (shell.test('-d', relativePath('../documentation/images/'))) shell.rm('-rf', relativePath('../documentation/images/'));
    if (shell.test('-d', relativePath('../documentation/styles/'))) shell.rm('-rf', relativePath('../documentation/styles/'));
    if (shell.test('-d', relativePath('../documentation/js/'))) shell.rm('-rf', relativePath('../documentation/js/'));
  }

}


//
// INIT
//
const initialCleanup = () => {
  if (shell.test('-d', relativePath('../documentation'))) shell.rm('-rf', relativePath('../documentation/'));
  if (shell.test('-d', relativePath('../dist'))) shell.rm('-rf', relativePath('../dist/'));
  shell.mkdir(relativePath('../dist/'));
};

if (argv.watch) {
  var gaze = new Gaze('../src/**/*');
  gaze.on('all', (event, filepath) => {
    try {
      //initialCleanup();
      buildPackage('es5', true);
      buildPackage('es2015', true);
      shell.echo(chalk.green('>> =============='));
      shell.echo(chalk.green('>> DONE'));
      shell.echo(chalk.green('>> =============='));
    } catch(err) {
      console.log(err);
    }
  });
} else {
  initialCleanup();
  buildPackage('es5', false);
  buildPackage('es2015', false);
  shell.echo(chalk.green('>> =============='));
  shell.echo(chalk.green('>> DONE'));
  shell.echo(chalk.green('>> =============='));
}
