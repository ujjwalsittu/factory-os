# @factoryos/iot-protocol

The plant MQTT contract shared by the edge agent and the tap simulator (decision 063, [docs/07](../../docs/07-iot.md)):
topics `factoryos/{tenant}/{plant}/{device}/{metric}`; a machine tap publishes `{seq, state, at}` on metric `state`.
