# pi-notify

Pi extension that runs configured shell commands when the agent finishes or asks for input.

## Language

**Main agent**:
The root pi session the user launched; the only place notifications fire.
_Avoid_: parent session, root session, interactive session

**Subagent**:
A pi-subagents child session hosted in a process marked by `PI_SUBAGENT_CHILD=1`, where pi-notify stays fully inert.
_Avoid_: child, child host, worker
