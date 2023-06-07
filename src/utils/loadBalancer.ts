//SHA256 hash `uri` and `refreshDoc._rev` to get a unique ID
// const hashedId = SHA256(`${uri}-${refreshDoc._rev}`).toString();

//TODO: When scaling to multiple nodes, create a load balancing algorithm
export function getLoadBalancerId(str?: string) {
  return 1
}