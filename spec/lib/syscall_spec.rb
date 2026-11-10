# frozen_string_literal: true

require "rails_helper"

# Syscall shells out via Open3. These specs use real, portable commands (echo, cat,
# grep, false, a bad binary) so we exercise the actual success/failure/error paths
# rather than mocking Open3 away.
RSpec.describe Syscall do
  describe ".run" do
    it "returns stdout on success" do
      expect(Syscall.run("echo", "hello")).to eq("hello\n")
    end

    it "returns nil and logs structured error when the command exits non-zero" do
      expect(LogUtil).to receive(:log_error).with(
        "Syscall.run failed with command: false.",
        stdout: nil,
        stderr: nil,
        exitstatus: 1
      )
      expect(Syscall.run("false")).to be_nil
    end

    it "captures stderr and exitstatus when a command fails with output on stderr" do
      expect(LogUtil).to receive(:log_error).with(
        a_string_starting_with("Syscall.run failed with command:"),
        stdout: nil,
        stderr: a_string_matching(/No such file/i),
        exitstatus: be_a(Integer)
      )
      expect(Syscall.run("ls", "non_existent_file_xyz_12345")).to be_nil
    end

    it "returns nil and logs exception when the command cannot be executed" do
      expect(LogUtil).to receive(:log_error).with(
        "Syscall.run failed with command: this_binary_does_not_exist_zzz.",
        exception: an_instance_of(Errno::ENOENT),
        stdout: nil,
        stderr: nil,
        exitstatus: nil
      )
      expect(Syscall.run("this_binary_does_not_exist_zzz")).to be_nil
    end

    it "passes each argument separately (no shell interpolation)" do
      # If args were joined into a shell string, the '$' would expand; here it's literal.
      expect(Syscall.run("echo", "$HOME")).to eq("$HOME\n")
    end
  end

  describe ".run_in_dir" do
    it "runs the command in the given directory" do
      out = Syscall.run_in_dir("/", "pwd")
      expect(out&.strip).to eq("/")
    end

    it "returns nil and logs structured error on failure" do
      expect(LogUtil).to receive(:log_error).with(
        "Syscall.run_in_dir failed with command: false.",
        stdout: nil,
        stderr: nil,
        exitstatus: 1
      )
      expect(Syscall.run_in_dir("/", "false")).to be_nil
    end

    it "returns nil and logs exception when the command cannot be executed" do
      expect(LogUtil).to receive(:log_error).with(
        "Syscall.run_in_dir failed with command: this_binary_does_not_exist_zzz.",
        exception: an_instance_of(Errno::ENOENT),
        stdout: nil,
        stderr: nil,
        exitstatus: nil
      )
      expect(Syscall.run_in_dir("/", "this_binary_does_not_exist_zzz")).to be_nil
    end
  end

  describe ".pipe_with_output" do
    it "streams output through a pipeline of commands" do
      out = Syscall.pipe_with_output(["echo", "hi\nbye"], ["grep", "hi"])
      expect(out).to eq("hi\n")
    end

    it "returns nil and logs when the pipeline raises" do
      expect(LogUtil).to receive(:log_error).with(
        "Syscall.pipe_with_output failed with command: no_such_cmd_zzz",
        exception: an_instance_of(Errno::ENOENT),
        output: nil
      )
      expect(Syscall.pipe_with_output(["no_such_cmd_zzz"])).to be_nil
    end
  end

  describe ".pipe" do
    it "returns [true, stderr] when every command in the pipeline succeeds" do
      success, stderr = Syscall.pipe(["echo", "hello"], ["cat"])
      expect(success).to be(true)
      expect(stderr).to eq("")
    end

    it "returns false when a command in the pipeline fails" do
      success, = Syscall.pipe(["echo", "hi"], ["grep", "nomatch"])
      expect(success).to be(false)
    end

    it "logs error and re-raises when the pipeline raises an exception" do
      expect(LogUtil).to receive(:log_error).with(
        "Syscall.pipe failed with command: no_such_cmd_zzz",
        exception: an_instance_of(Errno::ENOENT),
        stderr: nil,
        exitstatuses: nil
      )
      expect do
        Syscall.pipe(["no_such_cmd_zzz"])
      end.to raise_error(Errno::ENOENT)
    end
  end

  describe ".s3_cp" do
    it "delegates to .run with aws s3 cp" do
      expect(Syscall).to receive(:run).with("aws", "s3", "cp", "s3://source", "s3://dest").and_return("ok")
      expect(Syscall.s3_cp("s3://source", "s3://dest")).to eq("ok")
    end
  end

  describe ".s3_mv_recursive" do
    it "delegates to .run with aws s3 mv --recursive" do
      expect(Syscall).to receive(:run).with("aws", "s3", "mv", "--recursive", "s3://source", "s3://dest").and_return("ok")
      expect(Syscall.s3_mv_recursive("s3://source", "s3://dest")).to eq("ok")
    end
  end

  describe ".s3_read_json" do
    it "fetches file to stdout and parses JSON" do
      expect(Syscall).to receive(:s3_cp).with("s3://bucket/test.json", "-").and_return('{"key": "value"}')
      expect(Syscall.s3_read_json("s3://bucket/test.json")).to eq({ "key" => "value" })
    end
  end
end
