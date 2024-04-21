// @ts-check
import {promises as fsp} from 'fs'
import {resolve} from 'path'
import {filesize} from 'filesize'
import {glob} from 'glob'
import chalk from 'chalk'

//GLOBAL FLAGS OBJ
const FLAGS = {
  p: './**',
  s: compareNone,
  m: false,
  t: 0,
  l: 'en-US',
  numberLocale: 'en-US' // I set this because I might not have the file help/msgs to print but can still print the number
}

let MSGS = await checkFileLocale(FLAGS.l)

function metricFileSize(fSize) {
  //gets file size or block size and returns it in metric string (exact bytes like MiB, GiB)
  return filesize(fSize, {base: 2, standard: 'jedec'})
}

// comparator utils for sort
function compareNums(a, b) {return a - b}
function compareStrs(a, b) {return a.localeCompare(b)}
function compareNone(a, b) {return 0}

function compareFileSize(a, b) {return compareNums(a.size, b.size)}
function compareFileName(a, b) {return compareStrs(a.name, b.name)}
function compareFileExt(a, b) {
  let extA = a.name.slice(a.name.lastIndexOf('.') + 1)
  let extB = b.name.slice(b.name.lastIndexOf('.') + 1)

  return compareStrs(extA, extB)
}
function desc(comparator) {
  return function(a, b) {
    return comparator(a, b) * -1
  }
}

async function parseInputs() {
  //returns obj for arguments, will end program if syntax is wrong or help(-h,--help) is called
  let argLen = process.argv.length
  if (argLen === 2) return
  //check if argument syntax is right and return obj
  else {
    for (let i = 2; i < argLen; i++) {
      let checkNextArg;
      if (i+1 < argLen) checkNextArg = process.argv[i+1].toLowerCase()
      switch (process.argv[i].toLowerCase()) {
        case '-p':
        case '--path':
          if (checkNextArg) {
            //I need to run glob twice, once here to check if path works and to default to recursion if file is passed in
            //and then once later for the actual files
            let results = await glob(checkNextArg, {matchBase: true})
            if (!results.length) {
              await usage(MSGS.BAD_PATH)
            }
            FLAGS.p = checkNextArg
            if (results.length === 1) {
              //if a file is passed in, glob will just return the file name back, we want to recurse it
              let checkDir = (await fsp.stat(results[0])).isDirectory()
              if (checkDir) FLAGS.p = `${checkNextArg}/**`
            }
            if (checkNextArg == '.') FLAGS.p = `${checkNextArg}/**`
          }
          else {
            await usage(MSGS.BAD_PATH)
          }
          i++
          break
        case '-s':
        case '--sort':
          if (checkNextArg === 'alpha') {
            //these two sorts compare different parts of a string
            FLAGS.s = compareFileName
            i++
          }
          else if (checkNextArg === 'exten') {
            FLAGS.s = compareFileExt
            i++
          }
          else if (checkNextArg === 'size') {
            FLAGS.s = desc(compareFileSize)
            i++
          }
          else await usage(MSGS.BAD_SORT)
          break
        case '-m':
        case '--metric':
          FLAGS.m = true
          break
        case '-t':
        case '--threshold':
          // @ts-ignore
          if (!isNaN(parseFloat(checkNextArg))) {
            // @ts-ignore
            FLAGS.t = parseFloat(checkNextArg)
            i++
          }
          else await usage(MSGS.BAD_THRESHOLD)
          break
        case '-l':
        case '--localization':
          try {
            // @ts-ignore
            let locale = checkNextArg.split('-')
            locale[0] = locale[0].toLowerCase()
            locale[1] = locale[1].toUpperCase()
            checkNumberLocale(`${locale[0]}-${locale[1]}`)
            MSGS = await checkFileLocale(`${locale[0]}-${locale[1]}`) //will give error and be caught if bad locale
            i++
          }
          catch {
            await usage(MSGS.BAD_LOCALE)
          }
          break
        default:
          //if -h or wrong arguments passed
          await usage(MSGS.H)
      }
    }
  }
}

async function usage(errMsg) {
  if (errMsg) console.log(errMsg)
  let text
  text = await fsp.readFile(`./help-${FLAGS.l}.txt`, 'utf-8')
  console.log(text)
  process.exit()
}

async function getBigFiles(arrOfFiles) {
  //takes an array of files passed from npm glob library
  //checks to make sure file sizes are right and changes array to an array of objects
  let files = []
  for (let path of arrOfFiles) {
    try {
      let stats = await fsp.stat(path)
      if (stats.isFile()) { //just to be cautious, double check if it is a file (because glob should have checked)
        if (stats.size < FLAGS.t) continue //file is not big enough
        let file = {name: path, size: stats.size}
        files.push(file)
      }
      //don't need to check not a file nor directory because glob does that
    } catch (err) {
      await usage(err)
    }
  }
  return files  
}

function printBigFiles(arrOfObjFiles) {
  arrOfObjFiles.sort(FLAGS.s)
  for (let file of arrOfObjFiles) {
    let siz = file.size
    if (FLAGS.m) siz = metricFileSize(siz)
    else siz = siz.toLocaleString(FLAGS.numberLocale)
    let theName = resolve(file.name)
    console.log(chalk.blue(`${theName}  ${siz}`))
  }
}

function checkNumberLocale(locale) {
  //checks if valid locale, meant to be in try catch block
  let num = 1
  num.toLocaleString(locale)
  FLAGS.numberLocale = locale
}

async function checkFileLocale(locale) {  
  //checks if we have file in that locale, defaults back to english if not
  try {
    FLAGS.l = locale
    return JSON.parse(await fsp.readFile(`./msgs-${locale}.json`, 'utf-8'))
  } catch {
    FLAGS.l = 'en-US'
    return JSON.parse(await fsp.readFile(`./msgs-en-US.json`, 'utf-8'))
  }
}

function spinner() {
  const spinStates = ['|', '/', '-', '\\']
  let count = 0
  return function() {
      count++
      process.stdout.write(`\b\b\t${spinStates[count % 4]}`)
  }
}


async function main() {
  //set language through environment variables
  if (process.env.LANG) {
    try {
      checkNumberLocale(process.env.LANG)
      MSGS = await checkFileLocale(process.env.LANG)
    } catch {
      //Invalid Locale in environment variable LANG
      //do nothing
    }
  }
  //start spinner
  let tick = spinner()
  let id = setInterval(tick, 750)

  await parseInputs()
  //call glob and check file sizes
  const globFiles = await glob(FLAGS.p, {matchBase: true, nodir: true})
  const files = await getBigFiles(globFiles) // can return null name dir if all file sizes are less than FLAGS.t

  //end spinner and backspace the last characters
  clearInterval(id)
  process.stdout.write('\b\b')
  
  //print files
  if (!files.length) {
    //to check if any files are big enough to print
    console.log(MSGS.TOO_BIG_THRESHOLD)
    return
  }
  printBigFiles(files)
}
main()