// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

contract MockERC20 {
    string public constant name = "Mock USD Coin";
    string public constant symbol = "mUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(
        address to,
        uint256 amount
    ) external virtual returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external virtual returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "ERC20: transfer to zero");
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract FeeOnTransferToken is MockERC20 {
    function transfer(address to, uint256 amount) external override returns (bool) {
        uint256 fee = amount / 100;
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(msg.sender, to, amount - fee);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] = approved - amount;
        uint256 fee = amount / 100;
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount - fee);
        return true;
    }
}

contract OutboundFeeToken is MockERC20 {
    function transfer(
        address to,
        uint256 amount
    ) external override returns (bool) {
        uint256 fee = amount / 100;
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(msg.sender, to, amount - fee);
        return true;
    }
}

contract FalseReturnToken is MockERC20 {
    bool public failTransfer;
    bool public failTransferFrom;

    function setFailures(bool transferFailure, bool transferFromFailure) external {
        failTransfer = transferFailure;
        failTransferFrom = transferFromFailure;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (failTransfer) return false;
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        if (failTransferFrom) return false;
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }
}

contract CallbackToken is MockERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    function configureCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        callbackAttempted = false;
        callbackSucceeded = false;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        _attemptCallback();
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        _attemptCallback();
        return true;
    }

    function _attemptCallback() private {
        if (callbackTarget == address(0)) return;
        callbackAttempted = true;
        (callbackSucceeded, ) = callbackTarget.call(callbackData);
    }
}
