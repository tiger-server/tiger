# Tiger application structure

Tiger have 3 parts to make it run, the **engine**, **protocol/plugin**s and **tiger module**s(**tig**s).

## Engine

Tiger engine holds everything required to run the app by using plugins and defining modules.

Here is all the methods you can use on tiger engine:

 - `Tiger#define(module)`: to define a new module,
 - `Tiger#use(plugin)`: to use a plugin,
 - `Tiger#register(resolver)`: to register a protocol resolver, only can be used in plugin definition,
 - `Tiger#serve()`: main method to start the tiger server,

## Plugins

Plugins provides special ability to connect modules or communicate to external systems by registering
protocol resolver. A protocol resolver must implement at least one of the following methods:

 - `Resolver#define(target, module)`: to create a module runs on target,
 - `Resolver#notified(target, param)`: to communicate with module or external system on target.

see [Plugin](./plugin.md) for details.

## Modules

Modules are basic element for a Tiger application to run, it runs on a plugin/protocol target to be triggered.
A basic module definition has 2 parts:

 - The **target** with protocol,
 - The **processor**.

A processor is a function which takes few arguments and produces the state update. Usually (this is controlled by plugins) a processor is stateful, but you can ignore state update by returning an empty / undefined object.

Here is a general format for modules (you can also see `example/example.ts` for examples):
```typescript
interface Module<Param, State> {
  id?: string // will generate a default one if not provided
  target: string
  process: (State, Param) => State | void
}
```

These 2 parameters on the process method are:

  - Module **state**, initialized with an empty object,
  - Protocol-related **parameter**, in this example, an encapsulation of http request.

Module will extend an adapter to use tiger's abilities, including:

```typescript
interface ModuleAdapter {
  notify(target: string, param: Param): void;
  log(message: string): void;
  error(message: string): void;
  state(data?: Partial<State>): State;
}
```

So as you can see the module's behavior is tightly related to it's related protocol. You can see the [Plugin](./plugin.md) page for more information about these protocol and how to work with them.
