/* Why is protobufjs giving me JS Number values to represent protobufs
 * enum values when grpc gives me JS String values?
 *
 * https://github.com/dcodeIO/protobuf.js/issues/97
 */
const pbjs = require('protobufjs')
const protobufs = require('../src/protobufs')
const Path = require('path')
const fs = require('fs')
const util = require('util')

const FILE_MAGIC = '/* AUTO-GENERATED BY bs-grpc --- EDIT AT YOUR OWN PERIL */\n';

const dottedModuleName = moduleName =>
  moduleName.split('.').map((s,i) =>
    s[0].toUpperCase() + s.substr(1)
  ).join('.')
const lastDottedPart = moduleName => {
  const a = moduleName.split('.')
  return a[a.length-1]
}
const mapMessageType = messageType => messageType[1].toUpperCase() + messageType.substr(2) + '.t';
const mapEnumType = enumType => enumType[1].toUpperCase() + enumType.substr(2) + '.t';
const joinModuleName = (...args) => args.map(s => s[0]=='.'?s.substr(1):s).join('.')
const resolveRelative = (moduleName, scopeName) => {
  const scopeParts = scopeName.split('.')
  const moduleParts = moduleName.split('.')
  const max = Math.max(scopeParts.length, moduleParts.length)
  for (let i=0; i<max; i++)
    if (scopeParts[i] !== moduleParts[i])
      return moduleParts.slice(i).join('.')
  throw new Error("how do i name myself?")
}
const firstPart = s => s.split('.')[0]
/* TODO double-check this work
 * TODO what is this called?
 */
const sortish = (a, f) => {
  for (let i=0; i<a.length; i++) {
    for (let j=i+1; j<a.length; j++) {
      if (f(a[i], a[j]) < 0) {
        const tmp = a[i]
        a[i] = a[j]
        a[j] = tmp
      }
    }
  }
}

const mapType = (type, scopeName) => {
  switch (type.type) {
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_GROUP:
    default:
      return 'unknown_type /*'+type+'*/';
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_ENUM:
      return resolveRelative(mapEnumType(type.typeName), scopeName)
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_MESSAGE:
      return resolveRelative(mapMessageType(type.typeName), scopeName)
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_BOOL:
      return 'bool'
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_BYTES:
      return 'UNHANDLED_TYPE_BYTES'
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_STRING:
      return 'string'
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_DOUBLE:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_FLOAT:
      return 'float'
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_FIXED32:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_FIXED64:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_INT32:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_INT64:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_SFIXED32:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_SFIXED64:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_SINT32:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_SINT64:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_UINT32:
    case protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_UINT64:
      return 'int'
  }
}

require('read-all-stream')(process.stdin, {encoding:null}).then(buf => {
  const reader = pbjs.Reader.create(buf)
  require('fs').writeFileSync('cgr', buf)
  const req = protobufs.google.protobuf.compiler.CodeGeneratorRequest.decode(buf)

  // XXX deleting noise garbage i don't want to see
  req.protoFile.forEach(protoFile => delete protoFile.sourceCodeInfo)

  const rootModule = {moduleName:'*root*', modules:{}}

  function handleMessageType(parentModule, messageType) {
    /* Create module for this message type */
    const moduleName = dottedModuleName(joinModuleName(parentModule.moduleName, messageType.name))
    const module =  {
      modules: {},
      moduleName
    }
    parentModule.modules[lastDottedPart(moduleName)] = module
    const message = module.t = {
      fields: []
    }
    /* For each field defined... */
    messageType.field.forEach(field => {
      message.fields.push(field)
    })
    messageType.nestedType.forEach(nestedType => {
      handleMessageType(module, nestedType)
    })
    messageType.enumType.forEach(enumType => {
      handleEnumType(module, enumType)
    })
  }

  function handleEnumType(parentModule, enumType) {
    const moduleName = dottedModuleName(joinModuleName(parentModule.moduleName, enumType.name))
    const module = {
      modules: {},
      moduleName,
      t: { enumValues: enumType.value }
    }
    parentModule.modules[lastDottedPart(moduleName)] = module
  }

  /* For each .proto file... */
  req.protoFile.forEach(protoFile => {
    if (!protoFile.package) {
      console.error('your .proto file must contain a package name')
      process.exit(1)
    }
    /* Create module for this proto file */
    const protoFileModuleName = dottedModuleName(protoFile.package)
    const protoFileModule = {
      modules: {},
      moduleName: protoFileModuleName
    }
    rootModule.modules[lastDottedPart(protoFileModuleName)] = protoFileModule
    /* For each message type defined... */
    protoFile.messageType.forEach(messageType => {
      handleMessageType(protoFileModule, messageType)
    })
    protoFile.enumType.forEach(enumType => {
      handleEnumType(protoFileModule, enumType)
    })
    protoFile.service.forEach(service => {
      const moduleName = joinModuleName(protoFileModuleName, service.name)
      const serviceModule = {
        modules: [],
        moduleName,
        rpcs: service.method.map(method => {
          /* TODO support streaming */
          const name = method.name
          const inputType = mapMessageType(method.inputType)
          const outputType = mapMessageType(method.outputType)
          return {
            name,
            inputType,
            outputType
          }
        })
      }
      protoFileModule.modules[lastDottedPart(moduleName)] = serviceModule
    })
  })

  function identifyModules() {
    const foundModules = {}
    recurse(rootModule)
    function recurse(module) {
      foundModules[module.moduleName] = module;
      for (let moduleName in module.modules)
        recurse(module.modules[moduleName])
    }
    return foundModules;
  }
  function analyzeGraph() {
    const modules = identifyModules();
    for (let moduleName in modules) {
      modules[moduleName].dependencies = {}
      modules[moduleName].visiting = false
    }
    function recurse(module) {
      calcDependencies(module)
      for (let subModuleName in module.modules) {
        recurse(module.modules[subModuleName])
      }
    }
    for (let moduleName in modules)
      recurse(modules[moduleName], 0)
  }
  analyzeGraph()
  /* this is a little sloppy but gets us what we need */
  function calcDependencies(module) {
    module.dependencies = {}
    if ('t' in module) {
      if ('fields' in module.t) {
        module.t.fields.forEach(field => {
          if (field.type == protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_ENUM
            || field.type == protobufs.google.protobuf.FieldDescriptorProto.Type.TYPE_MESSAGE) {
            module.dependencies[firstPart(resolveRelative(mapMessageType(field.typeName), module.moduleName))] = true
          }
        })
      }
    }
  }

  const emitModule = module => {
    let code = ''
    /* diagnostic output */
    code += `/* moduleName = "${module.moduleName}" */\n`
    code += `/* dependencies = "${Object.keys(module.dependencies).join('", "')}" */\n`
    /* sort sub-modules by dependency */
    const subModuleNames = Object.keys(module.modules)
    sortish(subModuleNames, (a,b) => {
      const ma = module.modules[a]
      const mb = module.modules[b]
      return a in mb.dependencies ? 1 : b in ma.dependencies ? -1 : 0
    })
    subModuleNames.sort((a,b) => module.modules[a].score-module.modules[b].score)
    /* emit code for each sub-module in order */
    subModuleNames.forEach(subModuleName => {
      code += `module ${subModuleName} {\n`
      code += emitModule(module.modules[subModuleName])
      code += `};\n`
    })
    /* emit code for any type contained in our module */
    if ('t' in module) {
      if ('fields' in module.t) {
        code += "type t = ";
        if (module.t.fields.length) {
          code += "{\n"
          module.t.fields.forEach(field => {
            code += `${field.name} : ${mapType(field, module.moduleName)},\n`
          })
          code += "}";
        } else {
          code += "unit"
        }
        code += ";\n";
      } else if ('enumValues' in module.t) {
        code += 'type t =\n';
        module.t.enumValues.forEach(enumValue => {
          code += `| ${enumValue.name}\n`
        })
        code += ';\n'
      }
    }
    /* emit code for any RPCs */
    if ('rpcs' in module) {
      module.rpcs.forEach(rpc => {
        const inputType = resolveRelative(rpc.inputType, module.moduleName)
        const outputType = resolveRelative(rpc.outputType, module.moduleName)
        code += `let ${rpc.name} = (input:${inputType}):${outputType} => foo;\n`;
      })
    }
    return code
  }

  const emission = FILE_MAGIC + emitModule(rootModule)

  if (process.stdout.isTTY) {
    console.log('stdout is a TTY; printing human-readable data')
    console.log('output module tree:', util.inspect(rootModule, {depth:99}))
    console.log('output source code:')
    console.log(emission)
  } else {
    process.stdout.write(
      protobufs.google.protobuf.compiler.CodeGeneratorResponse.encode({
        file: [{
          name: 'protobufs.re',
          content: emission
        }]
      }).finish()
    )
  }
}).catch(err => {
  console.error(__filename, "error", err)
})
