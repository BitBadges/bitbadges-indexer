// SHA256 hash `uri` and `refreshDoc._rev` to get a unique ID
// const hashedId = SHA256(`${uri}-${refreshDoc._rev}`).toString();

// Determinstically choose which node to assign the fetch too
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getLoadBalancerId(_str?: string) {
  return 0;
}
