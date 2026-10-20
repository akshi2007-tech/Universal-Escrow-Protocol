import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("EscrowModule", (m) => {
  const escrow = m.contract("Escrow");
  const testToken = m.contract("MockERC20");

  return { escrow, testToken };
});
