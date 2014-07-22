#!/usr/bin/node
var vtws         = require('node-vtiger')
var http         = require('http');
var url          = require('url');
var mp           = require('multiparty');
var telnet       = require('telnet');
var redis        = require('redis');
var multiline    = require('multiline');
var fs           = require('fs');
var path         = require('path');
var moment       = require('moment');
var wrench       = require('wrench');
var util         = require('util');

var config = require('./config')

rclient = redis.createClient();
// Some settings
VT_URL          = config.url
VT_USER         = config.user
VT_ACCESSKEY    = config.key
HTTP_SECRET     = config.secret

// Set defaults here
var defaultcontact = {
}
var defaultpot = {
  'cf_973': 'Kris Beem',
   'assigned_user_id': '19x328', // Kris Beem
}

// vTiger machine name: Jotform machine name
var map = {
  'pot': {
    'potentialname': 'q8_projectName8',
    'description': 'q6_projectDescription',
    'cf_1067': 'q9_projectX',
    //'cf_979': 'q10_preferredMaterial',
    'cf_1069': 'q14_projectPurpose14',
    'cf_1065': 'q11_materialVolume',
    'cf_981': 'q15_quantity15',
    //'cf_1265': 'q21_preferredMaterial21',
    },
  'contact': {
    'email': 'q4_email4',
    'phone': 'q7_phoneNumber7',
    'cf_1249': 'q17_companyName',
  },
}

console.log("Opening telnet server...");
telnet.createServer(function (tel) {
  pots = []
  tel.write(multiline(function(){/*
   ___            _    ____  ___        __
  / _ \___ ____  (_)__/ /  |/  /__ ____/ /   
 / , _/ _ `/ _ \/ / _  / /|_/ / _ `/ _  / -_)
/_/|_|\_,_/ .__/_/\_,_/_/  /_/\_,_/\_,_/\__/ 
         /_/                                 
*/}));
  tel.write('\n')
  list([], tel);
  command = ''
  tel.on('data', function (b) {
    if(b.toString()[b.length - 1] == '\n') {
      command += b.toString();
      command = command.replace(/\r?\n|\r/g, '').split(' ');
      switch (command[0]){
        case 'help':
          tel.write('import, discard, examine, list, exit\n> ')
          break;
        case 'import':
          importW(command, tel)
          break;
        case 'examine':
          examine(command, tel)
          break;
        case 'discard':
          discard(command, tel)
          break;
        case '':
          tel.write('> ');
          break;
        case 'exit':
          tel.end();
          break;
        case 'list':
          list(command, tel);
          break;
        default:
          tel.write('Not a valid command\n> ');
          break;
      }
      command = ''
    } else {
      command += b.toString();
    }
  });
}).listen(6501)

client = new vtws( VT_URL, VT_USER, VT_ACCESSKEY)

console.log("Logging into vTiger...");
client.doLogin(function(){
  console.log("vTiger login succeeded");
  /*client.doDescribe('Potentials', function(e,r,body){
    console.log(r);
  });*/
  //client.doRetrieve('5x12445', function(e,r){console.log(r)});
  console.log("Opening HTTP Server...");
  http.createServer(function(request, response){
    var path = url.parse(request.url).pathname;
    if(path == '/' + HTTP_SECRET){
      var raw = '';
      var form = new mp.Form();
      form.parse(request, function(err, fields) {
        if(!err){
          importV(JSON.parse(fields.rawRequest[0]));
          response.writeHead(200, {'Content-Type': 'text/plain'});
          response.end();
        } else {
          console.error(err);
          response.writeHead(500, {'Content-Type': 'text/plain'});
          response.end();
        }
    });
    } else {
      console.warn("WARN " + "Got an unauthorized callback from " + request.connection.remoteAddress);
      response.statusCode = 401;  // unauthorized
      response.end();
    }
  }).listen(6500);
});

function list(command, tel){
  rclient.llen('pots', function(err, len){
    tel.write('There are currently ' + len + ' quick quotes ready to be imported: \n')
    rclient.lrange('pots',0, -1, function(err, reply){
      pots = reply;
      pots.forEach(function(element, index) {
        tel.write(index + ')' + ' ' + JSON.parse(element).pot['potentialname']+'\n');
      });
      tel.write('> ')
    });
  });
}
function importW(command, tel) {
  rclient.lrange('pots', command[1], command[1], function(err, raw){
    pot = JSON.parse(raw[0]).pot;
    contact = JSON.parse(raw[0]).contact;
    if(command[2] != '--match-contact'){
      client.doCreate('Contacts', contact, function(e,r,body){
        tel.write('Contact created: ' + contact.firstname + ' ' + contact.lastname + '\n');
        importPOT(tel,pot,r,contact)
      });
    } else {
      client.doQuery("select * from Contacts where lastname='"+contact.lastname+"' and firstname='"+contact.firstname+"';", function(e,r){
        if(r){
          r = r[0]
          tel.write('Contact found: ' + r.id + '\n');
          importPOT(tel,pot,r,contact)
        } else {
          tel.write('Could not find a contact named ' + contact.firstname + ' ' + contact.lastname + '\n')
          tel.write('\n> ')
        }
      });
    }
  });
}

function importPOT(tel, pot, r, contact) {
  pot.contact_id = r.id
  contact.cf_1249 = r.cf_1249
  client.doCreate('Potentials', pot, function(e,r,body){
    if(e) {
      tel.write(e)
    } else {
      tel.write('POT created: ' + r.potential_no+'\n')
      try {
        if(contact.cf_1249) {
          preamble = '/mnt/r/RM Clients/'+contact.cf_1249+' - '+contact.firstname + ' ' + contact.lastname+'/'+r.potential_no+' '+r.potentialname
        } else {
          preamble = '/mnt/r/RM Clients/'+contact.firstname + ' ' + contact.lastname+'/'+r.potential_no+' '+r.potentialname
        }
        fs.mkdirParent(preamble+'/Operations');
        fs.mkdirParent(preamble+'/Operations/CAD Files');
        fs.mkdirParent(preamble+'/Operations/Files from Client');
        fs.mkdirParent(preamble+'/Operations/Files from Client/'+pot.yymmdd);
        fs.mkdirParent(preamble+'/Operations/POs to Vendor');
        fs.mkdirParent(preamble+'/Operations/Quotes from Vendor');
        fs.mkdirParent(preamble+'/Operations/Released');
        fs.mkdirParent(preamble+'/Sales');
        fs.mkdirParent(preamble+'/Sales/Files from Client');
        fs.mkdirParent(preamble+'/Sales/Invoices to Client');
        fs.mkdirParent(preamble+'/Sales/POs from Client');
        fs.mkdirParent(preamble+'/Sales/Quotes to Client');
        fs.mkdirParent(preamble+'/Sales/SOs to Client');
        wrench.chmodSyncRecursive(preamble+'/..', 0666);
        wrench.chownSyncRecursive(preamble+'/..', 544, 513);
        tel.write('Created directory structure')
      } catch (err){
        tel.write('Failed to create file structure: ' + err);
      }
    }
    tel.write('\n> ')
  });
}

function discard(command, tel) {
  rclient.lrange('pots', command[1], command[1], function(err, raw){
    rclient.lrem('pots', 1, raw);
    tel.write('> ')
  });
}

function examine(command, tel) {
  rclient.lrange('pots', command[1], command[1], function(err, raw){
    pot = JSON.parse(raw[0]).pot
    contact = JSON.parse(raw[0]).contact
    tel.write('Name: ' + pot.potentialname+'\n');
    tel.write('Description: ' + pot.description+'\n');
    tel.write('Material: ' + pot.cf_1265+'\n');
    tel.write('Project purpose: ' + pot.cf_1069+'\n');
    tel.write('Quantity: ' + pot.cf_981+'\n');
    tel.write('Dimensions: ' + pot.cf_1067+'\n');
    tel.write('Volume: ' + pot.cf_1065+'\n');
    tel.write('Contact name: ' + contact.firstname + ' ' + contact.lastname+'\n');
    tel.write('Contact email: ' + contact.email+'\n');
    tel.write('Contact company: ' + contact.cf_1249+'\n');
    tel.write('> ')
  });
}

function importV(form){
  contact = defaultcontact;
  pot = defaultpot;

  Object.keys(map.contact).forEach(function(value, index){
    contact[value] = form[map.contact[value]];
  });

  contact.firstname = form['q3_fullName3']['first']
  contact.lastname = form['q3_fullName3']['last']
  Object.keys(map.pot).forEach(function(value, index){
    pot[value] = form[map.pot[value]];
  });
  if(form['q19_desiredProject19']) {
    pot.cf_755 = form['q19_desiredProject19'].year +'-'+ form['q19_desiredProject19'].month +'-'+ form['q19_desiredProject19'].day;
  }
  if(form['q20_preferredMaterial20']) {
    pot.cf_1265 = form['q20_preferredMaterial20'].replace(new RegExp(', ', 'g'), ' |##| ');
  }
  pot.yymmdd = moment().format('YYMMDD');
  pair = {}
  pair.pot = pot
  pair.contact = contact
  rclient.rpush('pots', JSON.stringify(pair), function(){console.log('POT saved: ' + pot.potentialname)});
}

fs.mkdirParent = function(dirPath, mode, callback) {
  //Call the standard fs.mkdir
  try {
  fs.mkdirSync(dirPath, mode)
  } catch (error){
    //When it fail in this way, do the custom steps
    if (error && error.errno === 34) {
      //Create all the parents recursively
      fs.mkdirParent(path.dirname(dirPath), mode, callback);
      //And then the directory
      fs.mkdirParent(dirPath, mode, callback);
    }
  }
}
