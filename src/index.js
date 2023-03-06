import * as Automerge from "@automerge/automerge"
import * as Blockly from "blockly"
import { Events } from "blockly"

// get a docId from the url used to work together on on docId 
// with remote or local other user
let docId = window.location.hash.replace(/^#/, '')

// browser channel 
let channel = new BroadcastChannel(docId)

let doc = Automerge.init()

// renders thw whole doc from automerge by clearing the workspace 
// and refireing all events from the doc.events list
function render(doc) 
{
  // just render all events however group them to be able to filter them 
  // in the normal event handler
  Events.setGroup("my_events")

  // kill the variables seperate as no events are send by the
  // workspace clear
  deleteVariables()

  // will send delete events, ignore these as well as part of the my_events group
  primaryWorkspace.clear() 
  
  // now create and run all events in order from the document
  for (let i=0; i<doc.events.length;i++)
  {
      var event = doc.events[i];
      var primaryEvent = Blockly.Events.fromJson(event, primaryWorkspace);
      // run forwards 
      primaryEvent.run(true);
  }
  // end of my_events group
  Events.setGroup(false)
 
}

function deleteVariables() {
  var variables = primaryWorkspace.getAllVariables()
  for (var i = 0; i < variables.length; i++) {
    var variable = variables[i]

    // can not use deleteVariable directly as this can ask for user confirmation
    const uses = primaryWorkspace.getVariableUsesById(variable.getId())
    primaryWorkspace.variableMap.deleteVariableInternal(variable, uses)
  }
}

// event from remote on browser channel
channel.onmessage = (ev) => {
  
  if (receiveFromRemote())
  {
    //let [newDoc, patch] = Automerge.applyChanges(doc, ev.data.changes)
    let remoteDoc = Automerge.load(ev.data.binary)
    let newDoc = Automerge.merge(doc, remoteDoc)
    doc = newDoc
    render(newDoc)
  }
}

// check the gui if we should receive from remote
function receiveFromRemote() {
  return document.querySelector('input[name="receive_from_remote"]:checked').value==='receive_from_remote_on'
}

async function getDocFromBrowserCache()
{
    let localCopy = await localforage.getItem(docId)
    if (localCopy) {
        let newDoc = Automerge.merge(doc, Automerge.load(localCopy))
        doc = newDoc
        render(newDoc)    
    } 
}

// TODO starting using syncState instead of sending whole
// document on every update
// let syncState = Automerge.initSyncState()

function saveToRemote(docId, binary) {
    fetch(`http://localhost:5000/${docId}`, {
      body: binary,
      method: "post",
      headers: {
        "Content-Type": "application/octet-stream",
      }
    }).catch(err => console.log(err))
  }

function updateDoc(newDoc) {
    let binary = Automerge.save(newDoc)

    // save in browser cache
    localforage.setItem(docId, binary).catch(err => console.log(err))

    doc = newDoc
    
    if (sendToRemote())
    {  
      // only send changes on the channel: TODO if channel is dead for some time changes are not enough
      // let changes = Automerge.getChanges(doc, newDoc)
      //channel.postMessage({actorId, changes})
      let actorId = Automerge.getActorId(doc)
      channel.postMessage({actorId, binary})
      
      // save the whole document
      //saveToRemote(docId, binary)
    }
}

function sendToRemote() {
  return document.querySelector('input[name="sync_to_remote"]:checked').value==='sync_to_remote_on'
}

async function loadFromRemote(docId) {
    const response = await fetch(`http://localhost:5000/${docId}`)
    if (response.status !== 200) throw new Error('No saved draft for doc with id=' + docId)
    const respbuffer = await response.arrayBuffer()
    if (respbuffer.byteLength === 0) throw new Error('No saved draft for doc with id=' + docId)
    const view = new Uint8Array(respbuffer)
    let newDoc = Automerge.merge(doc, Automerge.load(view))
    doc = newDoc
    render(newDoc)
}

// add event to the list of doc events.
function addEvent(event) {
    let newDoc = Automerge.change(doc, doc => {
      if (!doc.events) doc.events = []
      doc.events.push( event )
    })
    updateDoc(newDoc)
}

var toolbox = {
    "kind": "flyoutToolbox",
    "contents": [
      {
        "kind": "block",
        "type": "controls_if"
      },
      {
        "kind": "block",
        "type": "logic_compare"
      },
      {
        "kind": "block",
        "type": "controls_repeat_ext"
      },
      {
        "kind": "block",
        "type": "math_number",
        "fields": {
          NUM: 123
        }
      },
      {
        "kind": "block",
        "type": "math_arithmetic"
      },
      {
        "kind": "block",
        "type": "text"
      },
      {
        "kind": "block",
        "type": "text_print"
      },
      {
        "kind": "block",
        "type": "variables_get",
        "fields": {
          "VAR": {
            "name": "i"
          }
        }
      },
      {
        "kind": "block",
        "type": "variables_get",
        "fields": {
          "VAR": {
            "name": "j"
          }
        }
      },
      {
        "kind": "block",
        "type": "variables_get",
        "fields": {
          "VAR": {
            "name": "k"
          }
        }
      },
    ]
  };

// Inject primary workspace. 
var primaryWorkspace = Blockly.inject('primaryDiv',
    {media: 'https://unpkg.com/blockly/media/',
      toolbox: toolbox});
// Inject secondary workspace.
var secondaryWorkspace = Blockly.inject('secondaryDiv',
    {media: 'https://unpkg.com/blockly/media/',
      readOnly: true});

//loadFromRemote(docId)
getDocFromBrowserCache();

// Listen to events on primary workspace.
primaryWorkspace.addChangeListener(mirrorEvent);

// send the document as soon as the button is on again
document.getElementById('sync_to_remote').addEventListener('change', function(e) {
  if (e.target.value=='sync_to_remote_on')
  {  
    let binary = Automerge.save(doc)
    let actorId = Automerge.getActorId(doc)
    channel.postMessage({actorId, binary})
    
    // save the whole document
    //saveToRemote(docId, binary)
  }

} , false);

// receives every own workspace gui update both from the user
// as well as from the fired events in the render
function mirrorEvent(primaryEvent) {
  
  if (primaryEvent.isUiEvent) {
    return;  // Don't mirror UI events.
  }
  
  // Blockly issue/bug varType need some other
  // value than "" otherwise toJson fails
  if (primaryEvent.type==="var_create" || primaryEvent.type==="var_delete")
  {
    primaryEvent.varType="some"
  }

  // Convert event to JSON.  This could then be transmitted across the net.
  var json = primaryEvent.toJson();
  changeUndefinedToNull(json)
  setPrototype(json)
  // save the epoch to be able to replay
  json.datetime = Date.now()
      
  // do not send the events that we just received
  if (primaryEvent.group!=='my_events')
  {
    addEvent(json)
  }

  // Convert JSON back into an event, then execute it.
  var secondaryEvent = Blockly.Events.fromJson(json, secondaryWorkspace);
  secondaryEvent.run(true);
}

// undefined is not supported by automerge
// in place obj will be fixed
function changeUndefinedToNull(obj) {
  for (let key in obj) {
    if (obj[key] === undefined) {
      delete obj[key]
    } else if (typeof obj[key] === 'object') {
      changeUndefinedToNull(obj[key]);
    }
  }
}

// automerge uses a prototype to detect an object
// in place obj will be fixed
function setPrototype(obj) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if(obj[key] instanceof Array)
        {
          // no need to convert array: is supported by automerge
        }
        else
        {
          // Set the prototype of the nested object
          Object.setPrototypeOf(obj[key], Object.prototype);
        }
        // Recursively call the function on the nested object
        setPrototype(obj[key]);
      }
    }
  }
}
